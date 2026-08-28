import { MAX_DELIVERY_FAILURES } from './config.ts'
import { omitUndefined } from './json.ts'
import { defaultTimeZone } from './timezone.ts'
import { assertRule, beginRun, endRunMatches, isActiveRunBlocking, missedFireCount, nextRun, shouldFire } from './calendar.ts'
import type { RoutinePersist } from './persist.ts'
import type { CreateRoutineInput, Routine, ScheduleRun, UpdateRoutineInput } from './types.ts'
import { RoutineError, RUN_HISTORY_CAP } from './types.ts'

export interface FireDecision {
  readonly routine: Routine
  readonly missedCount: number
  readonly activeRunId: string
}

export class RoutineStore {
  private routines = new Map<string, Routine>()
  private loaded = false

  constructor(
    private readonly persist: RoutinePersist,
    private readonly staleAfterMs = 21_600_000,
  ) {}

  async load(now = Date.now()): Promise<void> {
    const snapshot = await this.persist.load()
    this.routines = new Map()
    let dirty = false
    for (const raw of snapshot.routines) {
      const routine = recoverOnLoad(raw, now, this.staleAfterMs)
      if (routine !== raw) dirty = true
      this.routines.set(routine.id, routine)
    }
    this.loaded = true
    if (dirty) await this.flush()
  }

  private async flush(): Promise<void> {
    await this.persist.save({ version: 1, routines: this.list() })
  }

  list(): Routine[] {
    return [...this.routines.values()].sort((a, b) => a.createdAt - b.createdAt)
  }

  get(id: string): Routine | undefined {
    return this.routines.get(id)
  }

  require(id: string): Routine {
    const routine = this.routines.get(id)
    if (!routine) throw new RoutineError(`routine "${id}" not found`, 'ROUTINE_NOT_FOUND')
    return routine
  }

  /** Model and host create always land paused. Only `enable` can arm. */
  async create(input: CreateRoutineInput, now = Date.now()): Promise<Routine> {
    const title = input.title.trim()
    const promptTemplate = input.promptTemplate.trim()
    if (!title) throw new RoutineError('routine title is required', 'ROUTINE_INVALID')
    if (!promptTemplate) throw new RoutineError('routine promptTemplate is required', 'ROUTINE_INVALID')
    const rule = assertRule(input.rule)
    const timezone = input.timezone?.trim() || defaultTimeZone()
    const draft: Routine = {
      id: crypto.randomUUID(),
      title,
      promptTemplate,
      parameters: { ...input.parameters ?? {} },
      enabled: false,
      timezone,
      rule,
      ...input.quietHours ? { quietHours: withZone(input.quietHours, timezone) } : {},
      ...input.window ? { window: withZone(input.window, timezone) } : {},
      ...input.maxRuns !== undefined ? { maxRuns: input.maxRuns } : {},
      mode: 'cron',
      ...input.workspaceCwd?.trim() ? { workspaceCwd: input.workspaceCwd.trim() } : {},
      ...input.preset?.trim() ? { preset: input.preset.trim() } : {},
      createdAt: now,
      updatedAt: now,
      runCount: 0,
      deliveryFailures: 0,
      runs: [],
    }
    const routine = withNextRun(draft, now)
    this.routines.set(routine.id, routine)
    await this.flush()
    return routine
  }

  /** Model/host update always persists `enabled: false`. */
  async update(id: string, input: UpdateRoutineInput, now = Date.now()): Promise<Routine> {
    const current = this.require(id)
    const timezone = input.timezone?.trim() || current.timezone
    const next: Routine = omitUndefined({
      ...current,
      enabled: false,
      ...input.title !== undefined ? { title: requireText(input.title, 'title') } : {},
      ...input.promptTemplate !== undefined ? { promptTemplate: requireText(input.promptTemplate, 'promptTemplate') } : {},
      ...input.parameters !== undefined ? { parameters: { ...input.parameters } } : {},
      timezone,
      ...input.rule !== undefined ? { rule: assertRule(input.rule) } : {},
      quietHours: input.quietHours === null
        ? undefined
        : input.quietHours
          ? withZone(input.quietHours, timezone)
          : current.quietHours,
      window: input.window === null
        ? undefined
        : input.window
          ? withZone(input.window, timezone)
          : current.window,
      maxRuns: input.maxRuns === null ? undefined : input.maxRuns ?? current.maxRuns,
      workspaceCwd: input.workspaceCwd === null ? undefined : input.workspaceCwd ?? current.workspaceCwd,
      preset: input.preset === null ? undefined : input.preset ?? current.preset,
      updatedAt: now,
    })
    const routine = withNextRun(next, now)
    this.routines.set(id, routine)
    await this.flush()
    return routine
  }

  async delete(id: string): Promise<Routine> {
    const routine = this.require(id)
    this.routines.delete(id)
    await this.flush()
    return routine
  }

  /** Host RPC / settings only. Not a model tool. */
  async enable(id: string, enabled: boolean, now = Date.now()): Promise<Routine> {
    const current = this.require(id)
    const routine = withNextRun({ ...current, enabled, updatedAt: now }, now)
    this.routines.set(id, routine)
    await this.flush()
    return routine
  }

  due(now: Date, staleAfterMs?: number): FireDecision[] {
    const due: FireDecision[] = []
    for (const routine of this.routines.values()) {
      if (!shouldFire(routine, now, staleAfterMs ?? this.staleAfterMs)) continue
      due.push({
        routine,
        missedCount: missedFireCount(routine, now),
        activeRunId: routine.activeRun?.id ?? '',
      })
    }
    return due
  }

  /**
   * Claim a due fire. Sets the overlap token only — lastRunAt / nextRunAt
   * commit in `finishFire` so a failed delivery can retry.
   */
  async claimFire(id: string, now: Date, options: {
    staleAfterMs?: number
    force?: boolean
  } = {}): Promise<FireDecision> {
    const current = this.require(id)
    const staleAfterMs = options.staleAfterMs ?? this.staleAfterMs
    if (isActiveRunBlocking(current.activeRun, now, staleAfterMs)) {
      throw new RoutineError(`routine "${id}" has an in-flight run`, 'ROUTINE_OVERLAP')
    }
    if (!current.enabled) {
      throw new RoutineError(`routine "${id}" is paused`, 'ROUTINE_PAUSED')
    }
    if (!options.force && !shouldFire(current, now, staleAfterMs)) {
      throw new RoutineError(`routine "${id}" is not due`, 'ROUTINE_NOT_DUE')
    }
    const token = beginRun(now.getTime())
    const missedCount = options.force ? 0 : missedFireCount(current, now)
    const claimed: Routine = {
      ...current,
      activeRun: token,
      updatedAt: now.getTime(),
    }
    this.routines.set(id, claimed)
    await this.flush()
    return { routine: claimed, missedCount, activeRunId: token.id }
  }

  async finishFire(id: string, tokenId: string, result: {
    ok: boolean
    sessionId?: string
    note?: string
    missedCount?: number
  }, now = Date.now()): Promise<Routine> {
    const current = this.require(id)
    if (!endRunMatches(current.activeRun, tokenId)) {
      return current
    }
    const run: ScheduleRun = {
      id: tokenId,
      startedAt: current.activeRun?.startedAt ?? now,
      ...result.sessionId ? { sessionId: result.sessionId } : {},
      ...result.note ? { note: result.note } : {},
      ...result.missedCount ? { missedCount: result.missedCount } : {},
    }
    if (result.ok) {
      const committed: Routine = {
        ...current,
        activeRun: undefined,
        lastRunAt: now,
        runCount: current.runCount + 1,
        deliveryFailures: 0,
        runs: [...current.runs, run].slice(-RUN_HISTORY_CAP),
        updatedAt: now,
      }
      const routine = withNextRun(committed, now)
      this.routines.set(id, routine)
      await this.flush()
      return routine
    }

    const failures = current.deliveryFailures + 1
    const exhausted = failures >= MAX_DELIVERY_FAILURES
    const failed: Routine = {
      ...current,
      activeRun: undefined,
      deliveryFailures: exhausted ? 0 : failures,
      ...exhausted ? { lastRunAt: now } : {},
      runs: [...current.runs, {
        ...run,
        note: exhausted
          ? `${result.note ?? 'delivery failed'}; advanced after ${MAX_DELIVERY_FAILURES} failed ticks`
          : `${result.note ?? 'delivery failed'}; retry ${failures}/${MAX_DELIVERY_FAILURES}`,
      }].slice(-RUN_HISTORY_CAP),
      updatedAt: now,
    }
    const routine = exhausted ? withNextRun(failed, now) : failed
    this.routines.set(id, routine)
    await this.flush()
    return routine
  }

  get loadedOnce(): boolean {
    return this.loaded
  }
}

function recoverOnLoad(routine: Routine, now: number, staleAfterMs: number): Routine {
  const stale = routine.activeRun !== undefined && !isActiveRunBlocking(routine.activeRun, new Date(now), staleAfterMs)
  const { activeRun, nextRunAt: _drop, ...base } = routine
  const next: Routine = omitUndefined({
    ...base,
    deliveryFailures: routine.deliveryFailures ?? 0,
    runs: routine.runs ?? [],
    mode: 'cron' as const,
    ...!stale && activeRun ? { activeRun } : {},
  })
  return assignNextRun(next, now)
}

/** Omit `nextRunAt` when there is no next fire. Never write `undefined`. */
function assignNextRun(routine: Routine, now: number): Routine {
  const stamp = nextRun(routine, new Date(now))?.getTime()
  const { nextRunAt: _drop, ...rest } = routine
  return omitUndefined(stamp === undefined ? rest : { ...rest, nextRunAt: stamp })
}

function withNextRun(routine: Routine, now: number): Routine {
  return assignNextRun({ ...routine, updatedAt: now }, now)
}

function withZone<T extends { timeZoneIdentifier?: string }>(window: T, timezone: string): T {
  return { ...window, timeZoneIdentifier: window.timeZoneIdentifier || timezone }
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new RoutineError(`routine ${field} is required`, 'ROUTINE_INVALID')
  return trimmed
}
