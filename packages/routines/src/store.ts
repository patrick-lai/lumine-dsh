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

  constructor(private readonly persist: RoutinePersist) {}

  async load(): Promise<void> {
    const snapshot = await this.persist.load()
    this.routines = new Map(snapshot.routines.map(routine => [routine.id, routine]))
    this.loaded = true
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
      enabled: input.enabled !== false,
      timezone,
      rule,
      ...input.quietHours ? { quietHours: withZone(input.quietHours, timezone) } : {},
      ...input.window ? { window: withZone(input.window, timezone) } : {},
      ...input.maxRuns !== undefined ? { maxRuns: input.maxRuns } : {},
      mode: input.mode === 'grind' ? 'grind' : 'cron',
      ...input.workspaceCwd?.trim() ? { workspaceCwd: input.workspaceCwd.trim() } : {},
      ...input.preset?.trim() ? { preset: input.preset.trim() } : {},
      ...input.event ? { event: normalizeEvent(input.event) } : {},
      ...input.grind ? { grind: input.grind } : {},
      createdAt: now,
      updatedAt: now,
      runCount: 0,
      runs: [],
    }
    const routine = withNextRun(draft, now)
    this.routines.set(routine.id, routine)
    await this.flush()
    return routine
  }

  async update(id: string, input: UpdateRoutineInput, now = Date.now()): Promise<Routine> {
    const current = this.require(id)
    const timezone = input.timezone?.trim() || current.timezone
    const next: Routine = {
      ...current,
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
      ...input.mode !== undefined ? { mode: input.mode === 'grind' ? 'grind' : 'cron' } : {},
      workspaceCwd: input.workspaceCwd === null ? undefined : input.workspaceCwd ?? current.workspaceCwd,
      preset: input.preset === null ? undefined : input.preset ?? current.preset,
      event: input.event === null ? undefined : input.event ? normalizeEvent(input.event) : current.event,
      grind: input.grind === null ? undefined : input.grind ?? current.grind,
      updatedAt: now,
    }
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
      if (!shouldFire(routine, now, staleAfterMs)) continue
      due.push({
        routine,
        missedCount: missedFireCount(routine, now),
        activeRunId: '',
      })
    }
    return due
  }

  /**
   * Claim a due or run-now fire. Sets the overlap token before any await
   * so a second tick in the same turn already sees the routine as busy.
   * Catch-up records collapsed fires but still launches exactly once.
   */
  async claimFire(id: string, now: Date, options: {
    staleAfterMs?: number
    force?: boolean
    triggerKind?: string
    eventName?: string
  } = {}): Promise<FireDecision> {
    const current = this.require(id)
    const blocking = isActiveRunBlocking(current.activeRun, now, options.staleAfterMs)
    if (blocking) {
      throw new RoutineError(`routine "${id}" has an in-flight run`, 'ROUTINE_OVERLAP')
    }
    if (!options.force && !shouldFire(current, now, options.staleAfterMs)) {
      throw new RoutineError(`routine "${id}" is not due`, 'ROUTINE_NOT_DUE')
    }
    const token = beginRun(now.getTime())
    const missedCount = options.force ? 0 : missedFireCount(current, now)
    const run: ScheduleRun = {
      id: token.id,
      startedAt: now.getTime(),
      triggerKind: options.triggerKind ?? (options.force ? 'runNow' : 'schedule'),
      ...options.eventName ? { eventName: options.eventName } : {},
      ...missedCount > 0 ? { missedCount, note: `catch-up-once; ${missedCount} collapsed fire(s)` } : {},
    }
    const claimed: Routine = {
      ...current,
      activeRun: token,
      lastRunAt: now.getTime(),
      ...options.eventName ? { lastEventFireAt: now.getTime() } : {},
      runCount: current.runCount + 1,
      runs: [...current.runs, run].slice(-RUN_HISTORY_CAP),
      updatedAt: now.getTime(),
    }
    const routine = withNextRun(claimed, now.getTime())
    this.routines.set(id, routine)
    await this.flush()
    return { routine, missedCount, activeRunId: token.id }
  }

  async finishFire(id: string, tokenId: string, patch: Partial<ScheduleRun> = {}, now = Date.now()): Promise<Routine> {
    const current = this.require(id)
    const runs = current.runs.map(run => run.id === tokenId ? { ...run, ...patch } : run)
    const cleared = endRunMatches(current.activeRun, tokenId)
    const next: Routine = {
      ...current,
      runs,
      ...cleared ? { activeRun: undefined } : {},
      updatedAt: now,
    }
    const routine = withNextRun(next, now)
    this.routines.set(id, routine)
    await this.flush()
    return routine
  }

  eventMatches(name: string, now: Date, staleAfterMs?: number): Routine[] {
    const normalized = name.trim().toLowerCase()
    const matched: Routine[] = []
    for (const routine of this.routines.values()) {
      if (!routine.enabled || !routine.event?.names.includes(normalized)) continue
      const cooldown = (routine.event.cooldownSeconds ?? 2) * 1000
      if (routine.lastEventFireAt !== undefined && now.getTime() - routine.lastEventFireAt < cooldown) continue
      if (routine.activeRun && (staleAfterMs === undefined || staleAfterMs <= 0 || now.getTime() - routine.activeRun.startedAt < staleAfterMs)) {
        continue
      }
      if (routine.maxRuns !== undefined && routine.runCount >= routine.maxRuns) continue
      matched.push(routine)
    }
    return matched
  }

  get loadedOnce(): boolean {
    return this.loaded
  }
}

function withNextRun(routine: Routine, now: number): Routine {
  const next = nextRun(routine, new Date(now))
  return { ...routine, nextRunAt: next?.getTime(), updatedAt: now }
}

function withZone<T extends { timeZoneIdentifier?: string }>(window: T, timezone: string): T {
  return { ...window, timeZoneIdentifier: window.timeZoneIdentifier || timezone }
}

function requireText(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new RoutineError(`routine ${field} is required`, 'ROUTINE_INVALID')
  return trimmed
}

function normalizeEvent(event: NonNullable<CreateRoutineInput['event']>): NonNullable<Routine['event']> {
  const names = [...new Set(event.names.map(name => name.trim().toLowerCase()).filter(Boolean))].sort()
  if (names.length === 0) throw new RoutineError('event trigger requires at least one name', 'ROUTINE_INVALID')
  return {
    names,
    ...event.cooldownSeconds !== undefined ? { cooldownSeconds: event.cooldownSeconds } : {},
  }
}
