import { spawnRoutineSession, type DeliverContext } from './deliver.ts'
import { RoutineStore } from './store.ts'
import type { CreateRoutineInput, Routine, UpdateRoutineInput } from './types.ts'
import { RoutineError } from './types.ts'

const SKIP_CODES = new Set(['ROUTINE_PAUSED', 'ROUTINE_OVERLAP', 'ROUTINE_NOT_DUE'])

export class RoutineRuntime {
  constructor(
    public store: RoutineStore,
    private readonly deliverCtx: DeliverContext,
    private readonly now: () => number = Date.now,
  ) {}

  list(): Routine[] {
    return this.store.list()
  }

  get(id: string): Routine | undefined {
    return this.store.get(id)
  }

  /** Model-facing create: always lands paused. */
  async create(input: CreateRoutineInput): Promise<Routine> {
    return this.store.create(input, this.now())
  }

  /** Model-facing update: always leaves the row paused. */
  async update(id: string, patch: UpdateRoutineInput): Promise<Routine> {
    return this.store.update(id, patch, this.now())
  }

  async delete(id: string): Promise<Routine> {
    return this.store.delete(id)
  }

  /** Host / settings only. Not a model tool. */
  async enable(id: string, enabled: boolean): Promise<Routine> {
    return this.store.enable(id, enabled, this.now())
  }

  /**
   * Model-facing immediate fire. Refuses a paused row.
   */
  async runNow(id: string): Promise<{ sessionId?: string }> {
    const now = this.now()
    const claimed = await this.store.claimFire(id, new Date(now), { force: true })
    return this.launch(claimed, now, true)
  }

  async runDue(now: number = this.now()): Promise<void> {
    const date = new Date(now)
    for (const due of this.store.due(date)) {
      try {
        const claimed = await this.store.claimFire(due.routine.id, date)
        await this.launch(claimed, now, false)
      } catch (error) {
        if (error instanceof RoutineError && SKIP_CODES.has(error.code)) continue
        throw error
      }
    }
  }

  private async launch(
    claimed: { routine: Routine; activeRunId: string; missedCount: number },
    now: number,
    throwOnFailure: boolean,
  ): Promise<{ sessionId?: string }> {
    const { routine, activeRunId, missedCount } = claimed
    const result = await spawnRoutineSession(this.deliverCtx, routine, now)
    const note = [result.note, missedCount > 0 ? `missed ${missedCount} tick(s)` : undefined]
      .filter(Boolean)
      .join('; ')
    await this.store.finishFire(routine.id, activeRunId, {
      ok: result.ok,
      sessionId: result.sessionId,
      note: note || undefined,
      missedCount,
    }, now)
    if (!result.ok && throwOnFailure) {
      throw new RoutineError(result.note ?? 'routine delivery failed', 'ROUTINE_DELIVERY_FAILED')
    }
    return { sessionId: result.sessionId }
  }
}
