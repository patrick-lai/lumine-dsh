import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ResolvedConfig } from './config.ts'
import { filePersist, openPersist, type RoutinePersist } from './persist.ts'
import { installRoutineRemoteMarkers } from './remote.ts'
import { routineRpcHandlers } from './rpc-payload.ts'
import { RoutineRuntime } from './runtime.ts'
import { RoutineStore } from './store.ts'
import { registerRoutineTools } from './tools.ts'
import type { CreateRoutineInput, Routine, UpdateRoutineInput } from './types.ts'
import { RoutineError } from './types.ts'

// @deepseek-ai/cordis exports `const enum FiberState` (PENDING=0 … UNLOADING=5).
// Const enums are erased — the published JS has no runtime `FiberState` export.
const FIBER_FAILED = 3
const FIBER_DISPOSED = 4
const FIBER_UNLOADING = 5

const INACTIVE = new Set<number>([FIBER_FAILED, FIBER_DISPOSED, FIBER_UNLOADING])

export interface RoutineServiceOptions extends ResolvedConfig {
  persist?: RoutinePersist
  now?: () => number
}

/**
 * Host-plane routine store and timer. Model tools are routine_list / create /
 * update / delete / run_now. `enable` is host RPC / settings only.
 *
 * Live Cordis service key and Typert namespace are both `routine`, so the
 * gateway SRC-discovers `routine/list` and friends.
 */
export class RoutineService extends TypertRemoteService {
  /**
   * Every hard `this.ctx.*` / `ctx.*` (not `ctx.get`) this fiber reads.
   * Official `ctx.interval` is mixed in by `timer`. Nested `ctx.inject`
   * is exclusive and never runs if the constructor already threw.
   */
  static inject = ['agents', 'timer', 'sessions']

  store: RoutineStore
  runtime: RoutineRuntime
  readonly resolved: ResolvedConfig
  private readonly now: () => number
  private readonly pending = new Set<Promise<void>>()
  private started = false
  private timerInstalled = false
  private toolsRegistered = false
  private readonly persistOverride?: RoutinePersist

  constructor(ctx: Context, options: RoutineServiceOptions) {
    super(ctx, 'routine')
    this.resolved = {
      defaultPreset: options.defaultPreset,
      ...options.defaultWorkspaceCwd ? { defaultWorkspaceCwd: options.defaultWorkspaceCwd } : {},
      tickMs: options.tickMs,
      staleAfterMs: options.staleAfterMs,
    }
    this.now = options.now ?? Date.now
    this.persistOverride = options.persist
    this.store = new RoutineStore(options.persist ?? filePersist(), this.resolved.staleAfterMs)
    this.runtime = this.bindRuntime()
    ctx.effect(() => {
      void this.start()
      return () => this.stop()
    }, 'lumineRoutines.start()')
    this.installTools()
  }

  async list(): Promise<{ routines: Routine[] }> {
    return (await this.rpc()).list()
  }

  async create(input: CreateRoutineInput): Promise<{
    routine: Routine
    enabled: false
    saved_paused: true
    operator_must_enable: true
  }> {
    return (await this.rpc()).create(input)
  }

  async update(id: string, input: UpdateRoutineInput): Promise<{
    routine: Routine
    enabled: false
    saved_paused: true
    operator_must_enable: true
  }> {
    return (await this.rpc()).update(id, input)
  }

  async delete(id: string): Promise<{ deleted: Routine }> {
    return (await this.rpc()).delete(id)
  }

  /** Host RPC / settings only. Not a model tool. */
  async enable(id: string, enabled: boolean): Promise<{ routine: Routine }> {
    return (await this.rpc()).enable(id, enabled)
  }

  async runNow(id: string): Promise<{ routine?: Routine; sessionId?: string }> {
    return (await this.rpc()).runNow(id)
  }

  private async rpc() {
    await this.ensureLoaded()
    return routineRpcHandlers({
      list: () => this.runtime.list(),
      create: input => this.runtime.create(input),
      update: (id, input) => this.runtime.update(id, input),
      delete: id => this.runtime.delete(id),
      enable: (id, enabled) => this.runtime.enable(id, enabled),
      runNow: async id => {
        const launched = await this.runtime.runNow(id)
        return { ...launched, routine: this.store.require(id) }
      },
      require: id => this.store.require(id),
    })
  }

  private bindRuntime(): RoutineRuntime {
    return new RoutineRuntime(this.store, {
      agents: this.ctx.agents,
      sessions: this.ctx.sessions,
      cwd: this.resolved.defaultWorkspaceCwd ?? process.cwd(),
      defaultPreset: this.resolved.defaultPreset,
    }, this.now)
  }

  private isActive(): boolean {
    return this.started && !INACTIVE.has(this.ctx.fiber.state)
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.store.loadedOnce) await this.store.load(this.now())
  }

  async start(): Promise<void> {
    if (!this.persistOverride) {
      const persist = await openPersist(this.ctx)
      if (persist.kind === 'storageDomain') {
        this.store = new RoutineStore(persist, this.resolved.staleAfterMs)
        this.runtime.store = this.store
      }
    }
    await this.ensureLoaded()
    this.started = true
    this.installTimer()
    await this.tick()
  }

  async stop(): Promise<void> {
    this.started = false
    await Promise.allSettled([...this.pending])
  }

  async tick(): Promise<void> {
    if (!this.isActive()) return
    await this.ensureLoaded()
    await this.track(this.runtime.runDue(this.now()))
  }

  private track(job: Promise<unknown>): Promise<void> {
    const wrapped = job.then(() => undefined, () => undefined)
    this.pending.add(wrapped)
    const forget = (): void => { this.pending.delete(wrapped) }
    void wrapped.then(forget, forget)
    return wrapped
  }

  /**
   * Use the existing cordis timer plugin (`ctx.interval`). Do not wrap a
   * second timer service (`setInterval`). Called from `start()` after this
   * fiber already has `timer` on `static inject` — never probe
   * `this.ctx.interval` from the constructor.
   */
  private installTimer(): void {
    if (this.timerInstalled) return
    this.ctx.interval(() => {
      void this.tick()
    }, this.resolved.tickMs)
    this.timerInstalled = true
  }

  private installTools(): void {
    const warn = (message: string): void => {
      this.ctx.get<{ warn(...args: unknown[]): void }>('logger')?.warn(message)
    }
    const register = (host: { tools?: { register?: (tool: unknown) => unknown }; logger?: { warn(...args: unknown[]): void } }): void => {
      if (this.toolsRegistered) return
      try {
        const names = registerRoutineTools(host, this.runtime)
        if (names.length > 0) this.toolsRegistered = true
      } catch (error) {
        warn(`lumine-routines: tools.register failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const tools = this.ctx.get<{ register?: (tool: unknown) => unknown }>('tools')
    if (tools) register({ tools, logger: this.ctx.get('logger') as { warn(...args: unknown[]): void } | undefined })
    try {
      this.ctx.inject(['tools'], toolsCtx => {
        register(toolsCtx)
      })
    } catch (error) {
      warn(`lumine-routines: tools inject failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

installRoutineRemoteMarkers(RoutineService)

export async function createRoutineService(ctx: Context, options: ResolvedConfig): Promise<RoutineService> {
  const persist = await openPersist(ctx)
  return new RoutineService(ctx, { ...options, persist })
}

export { RoutineError }
