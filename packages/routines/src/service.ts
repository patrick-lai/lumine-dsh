import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { normalizeEventName } from './calendar.ts'
import type { ResolvedConfig } from './config.ts'
import { executeRoutineCommand } from './command.ts'
import { deliverRoutine } from './deliver.ts'
import { filePersist, openPersist, type RoutinePersist } from './persist.ts'
import { RoutineStore } from './store.ts'
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
 * Host-plane routine store and timer. RPC names mirror DSH `goal.*`:
 * `routine.create|list|update|delete|enable|runNow`.
 */
export class RoutineService extends Service {
  static inject = ['agents']

  store: RoutineStore
  readonly resolved: ResolvedConfig
  private readonly now: () => number
  private readonly pending = new Set<Promise<void>>()
  private timer: ReturnType<typeof setInterval> | undefined
  private started = false

  constructor(ctx: Context, options: RoutineServiceOptions) {
    super(ctx, 'routines')
    this.resolved = {
      defaultPreset: options.defaultPreset,
      ...options.defaultWorkspaceCwd ? { defaultWorkspaceCwd: options.defaultWorkspaceCwd } : {},
      tickMs: options.tickMs,
      staleAfterMs: options.staleAfterMs,
      grindMaxTurns: options.grindMaxTurns,
    }
    this.now = options.now ?? Date.now
    this.store = new RoutineStore(options.persist ?? filePersist())
    this.persistOverride = options.persist
    ctx.effect(() => {
      void this.start()
      return () => this.stop()
    }, 'lumineRoutines.timer()')
    this.installHostEvents()
    this.tryExportRemote()
    ctx.inject(['commands'], commandCtx => {
      commandCtx.commands?.register({
        name: 'routine',
        description: 'create or run a host-owned durable routine (not dsh-schedule)',
        input: { hint: '[list|create <title> -- <prompt>|enable <id>|disable <id>|run <id>|delete <id>]' },
        handler: invocation => executeRoutineCommand(this, invocation),
      })
    })
  }

  private readonly persistOverride?: RoutinePersist

  private isActive(): boolean {
    return this.started && !INACTIVE.has(this.ctx.fiber.state)
  }

  async start(): Promise<void> {
    if (!this.persistOverride) {
      const persist = await openPersist(this.ctx)
      if (persist.kind === 'storageDomain') {
        this.store = new RoutineStore(persist)
      }
    }
    if (!this.store.loadedOnce) await this.store.load()
    this.started = true
    if (this.timer === undefined) {
      this.timer = setInterval(() => {
        void this.tick()
      }, this.resolved.tickMs)
      this.timer.unref?.()
    }
    await this.tick()
  }

  async stop(): Promise<void> {
    this.started = false
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    await Promise.allSettled([...this.pending])
  }

  async create(input: CreateRoutineInput): Promise<Routine> {
    if (!this.store.loadedOnce) await this.store.load()
    return this.store.create(input, this.now())
  }

  async list(): Promise<Routine[]> {
    if (!this.store.loadedOnce) await this.store.load()
    return this.store.list()
  }

  async update(id: string, input: UpdateRoutineInput): Promise<Routine> {
    if (!this.store.loadedOnce) await this.store.load()
    return this.store.update(id, input, this.now())
  }

  async delete(id: string): Promise<Routine> {
    if (!this.store.loadedOnce) await this.store.load()
    return this.store.delete(id)
  }

  async enable(id: string, enabled: boolean): Promise<Routine> {
    if (!this.store.loadedOnce) await this.store.load()
    return this.store.enable(id, enabled, this.now())
  }

  async runNow(id: string): Promise<Routine> {
    if (!this.store.loadedOnce) await this.store.load()
    return this.launch(id, { force: true, triggerKind: 'runNow' })
  }

  async tick(): Promise<void> {
    if (!this.isActive()) return
    if (!this.store.loadedOnce) await this.store.load()
    const now = new Date(this.now())
    for (const due of this.store.due(now, this.resolved.staleAfterMs)) {
      void this.track(this.launch(due.routine.id, { triggerKind: 'schedule' }))
    }
  }

  async handleHostEvent(name: string, payload: Record<string, string> = {}): Promise<string[]> {
    if (!this.store.loadedOnce) await this.store.load()
    const normalized = normalizeEventName(name)
    if (!normalized) return []
    const now = new Date(this.now())
    const matched = this.store.eventMatches(normalized, now, this.resolved.staleAfterMs)
    const ids: string[] = []
    for (const routine of matched) {
      void this.track(this.launch(routine.id, {
        force: true,
        triggerKind: 'event',
        eventName: normalized,
        extras: payload,
      }))
      ids.push(routine.id)
    }
    return ids
  }

  private async launch(id: string, options: {
    force?: boolean
    triggerKind?: string
    eventName?: string
    extras?: Record<string, string>
  }): Promise<Routine> {
    const now = new Date(this.now())
    const claimed = await this.store.claimFire(id, now, {
      staleAfterMs: this.resolved.staleAfterMs,
      force: options.force,
      triggerKind: options.triggerKind,
      eventName: options.eventName,
    })
    const abort = new AbortController()
    try {
      const delivered = await deliverRoutine(
        this.ctx,
        this.resolved,
        claimed.routine,
        {
          triggerKind: options.triggerKind ?? 'schedule',
          ...options.eventName ? { eventName: options.eventName } : {},
          ...options.extras,
        },
        abort.signal,
      )
      return await this.store.finishFire(id, claimed.activeRunId, {
        sessionId: delivered.sessionId,
        note: [claimed.missedCount > 0 ? `catch-up-once; ${claimed.missedCount} collapsed fire(s)` : undefined, delivered.note]
          .filter(Boolean)
          .join(' · '),
      }, this.now())
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger.error(`lumine-routines: delivery failed for ${id}: ${message}`)
      return await this.store.finishFire(id, claimed.activeRunId, {
        note: `delivery failed: ${message}`,
      }, this.now())
    }
  }

  private track(job: Promise<unknown>): Promise<void> {
    const wrapped = job.then(() => undefined, () => undefined)
    this.pending.add(wrapped)
    const forget = (): void => { this.pending.delete(wrapped) }
    void wrapped.then(forget, forget)
    return wrapped
  }

  private installHostEvents(): void {
    const emit = (name: string, payload: Record<string, string> = {}): void => {
      void this.handleHostEvent(name, payload)
    }
    this.ctx.on('agent/session-end', (payload: unknown) => {
      const record = asRecord(payload)
      emit('session-ended', {
        ...record.id ? { sessionId: record.id } : {},
        ...record.reason ? { reason: record.reason } : {},
      })
    })
    this.ctx.on('agent/error', (payload: unknown) => {
      const record = asRecord(payload)
      emit('session-failed', {
        ...record.id ? { sessionId: record.id } : {},
        ...record.message ? { message: record.message } : {},
      })
    })
  }

  /**
   * Official DSH RPC is `TypertRemoteService` + `@Remote`, which yields
   * `goal.create` on `ctx.goals`. We mirror that as `routine.*` when the
   * protocol package is present; otherwise in-process `ctx.routines` is enough.
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

function asRecord(payload: unknown): Record<string, string> {
  if (typeof payload !== 'object' || payload === null) return {}
  const source = payload as Record<string, unknown>
  const nested = typeof source.agent === 'object' && source.agent !== null
    ? source.agent as Record<string, unknown>
    : source
  const id = nested.id ?? source.id
  const reason = source.reason ?? source.cause
  const message = source.message ?? (source.error instanceof Error ? source.error.message : source.error)
  return {
    ...typeof id === 'string' ? { id } : {},
    ...typeof reason === 'string' ? { reason } : {},
    ...typeof message === 'string' ? { message } : {},
  }
}

export { RoutineError }
