import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type { ResolvedConfig } from './config.ts'
import { filePersist, openPersist, type RoutinePersist } from './persist.ts'
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
 * update / delete / run_now. `routine.enable` is host RPC / settings only.
 */
export class RoutineService extends Service {
  static inject = ['agents']

  store: RoutineStore
  runtime: RoutineRuntime
  readonly resolved: ResolvedConfig
  private readonly now: () => number
  private readonly pending = new Set<Promise<void>>()
  private started = false
  private toolsRegistered = false
  private readonly persistOverride?: RoutinePersist

  constructor(ctx: Context, options: RoutineServiceOptions) {
    super(ctx, 'routines')
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
    this.installTimer()
    this.installTools()
    this.tryExportRemote()
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

  async start(): Promise<void> {
    if (!this.persistOverride) {
      const persist = await openPersist(this.ctx)
      if (persist.kind === 'storageDomain') {
        this.store = new RoutineStore(persist, this.resolved.staleAfterMs)
        this.runtime.store = this.store
      }
    }
    if (!this.store.loadedOnce) await this.store.load(this.now())
    this.started = true
    await this.tick()
  }

  async stop(): Promise<void> {
    this.started = false
    await Promise.allSettled([...this.pending])
  }

  async create(input: CreateRoutineInput): Promise<Routine> {
    if (!this.store.loadedOnce) await this.store.load(this.now())
    return this.runtime.create(input)
  }

  async list(): Promise<Routine[]> {
    if (!this.store.loadedOnce) await this.store.load(this.now())
    return this.runtime.list()
  }

  async update(id: string, input: UpdateRoutineInput): Promise<Routine> {
    if (!this.store.loadedOnce) await this.store.load(this.now())
    return this.runtime.update(id, input)
  }

  async delete(id: string): Promise<Routine> {
    if (!this.store.loadedOnce) await this.store.load(this.now())
    return this.runtime.delete(id)
  }

  /** Host RPC / settings only. Not a model tool. */
  async enable(id: string, enabled: boolean): Promise<Routine> {
    if (!this.store.loadedOnce) await this.store.load(this.now())
    return this.runtime.enable(id, enabled)
  }

  async runNow(id: string): Promise<{ sessionId?: string; routine: Routine }> {
    if (!this.store.loadedOnce) await this.store.load(this.now())
    const launched = await this.runtime.runNow(id)
    return { ...launched, routine: this.store.require(id) }
  }

  async tick(): Promise<void> {
    if (!this.isActive()) return
    if (!this.store.loadedOnce) await this.store.load(this.now())
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
   * second timer service (`setInterval`).
   */
  private installTimer(): void {
    const startTick = (host: { interval?: (callback: () => unknown, delay: number) => unknown }): void => {
      if (typeof host.interval !== 'function') return
      host.interval(() => {
        void this.tick()
      }, this.resolved.tickMs)
    }
    if (typeof this.ctx.interval === 'function') {
      startTick(this.ctx)
      return
    }
    this.ctx.inject(['timer'], timerCtx => {
      startTick(timerCtx)
    })
  }

  private installTools(): void {
    const register = (host: { tools?: { register?: (tool: unknown) => unknown } }): void => {
      if (this.toolsRegistered) return
      const names = registerRoutineTools(host, this.runtime)
      if (names.length > 0) this.toolsRegistered = true
    }
    register(this.ctx)
    this.ctx.inject(['tools'], toolsCtx => {
      register(toolsCtx)
    })
  }

  /**
   * Official DSH RPC is `TypertRemoteService` + `@Remote`. Mirror `routine.*`
   * when a duck-typed rpc facility exists. `routine.enable` is host-only.
   */
  private tryExportRemote(): void {
    const methods = {
      create: (input: CreateRoutineInput) => this.create(input),
      list: () => this.list(),
      update: (id: string, input: UpdateRoutineInput) => this.update(id, input),
      delete: (id: string) => this.delete(id),
      enable: (id: string, enabled: boolean) => this.enable(id, enabled),
      runNow: (id: string) => this.runNow(id),
    }
    const rpc = this.ctx.get<{ register?: (name: string, handler: (...args: unknown[]) => unknown) => void }>('rpc')
    if (rpc && typeof rpc.register === 'function') {
      for (const [name, handler] of Object.entries(methods)) {
        rpc.register(`routine.${name}`, handler)
      }
    }
  }
}

export async function createRoutineService(ctx: Context, options: ResolvedConfig): Promise<RoutineService> {
  const persist = await openPersist(ctx)
  return new RoutineService(ctx, { ...options, persist })
}

export { RoutineError }
