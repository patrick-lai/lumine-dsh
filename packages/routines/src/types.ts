/** Cron = spawn + one prompt. Grind = same spawn, then hidden continue. */
export type RoutineMode = 'cron' | 'grind'

export type RoutineRule =
  | { readonly kind: 'once'; readonly at: number }
  | { readonly kind: 'interval'; readonly seconds: number }
  | { readonly kind: 'cron'; readonly cron: string }
  | { readonly kind: 'manual' }

/**
 * Optional weekday + local time-range guard. Weekdays use Foundation
 * numbering (1=Sunday … 7=Saturday) so the Lumine port stays comparable.
 */
export interface ScheduleWindow {
  readonly weekdays?: number[]
  readonly startMinute?: number
  readonly endMinute?: number
  readonly timeZoneIdentifier: string
  /** Per-weekday quiet ranges. Keys are Foundation weekdays. Values are [start, end]. */
  readonly weekdayMinutes?: Record<string, [number, number]>
}

export interface ActiveRun {
  readonly id: string
  readonly startedAt: number
}

export interface ScheduleRun {
  readonly id: string
  readonly startedAt: number
  readonly sessionId?: string
  readonly note?: string
  readonly triggerKind?: string
  readonly eventName?: string
  readonly missedCount?: number
  readonly heldForQuietHours?: boolean
}

export interface EventTrigger {
  readonly names: string[]
  readonly cooldownSeconds?: number
}

export interface GrindSettings {
  readonly maxIterations?: number
}

/** Host-owned durable automation. Never stored in a session event log. */
export interface Routine {
  readonly id: string
  readonly title: string
  readonly promptTemplate: string
  readonly parameters: Record<string, string>
  readonly enabled: boolean
  readonly timezone: string
  readonly rule: RoutineRule
  readonly quietHours?: ScheduleWindow
  readonly window?: ScheduleWindow
  readonly maxRuns?: number
  readonly mode: RoutineMode
  readonly workspaceCwd?: string
  readonly preset?: string
  readonly event?: EventTrigger
  readonly grind?: GrindSettings
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastRunAt?: number
  readonly lastEventFireAt?: number
  readonly nextRunAt?: number
  readonly runCount: number
  readonly runs: ScheduleRun[]
  readonly activeRun?: ActiveRun
}

export interface CreateRoutineInput {
  readonly title: string
  readonly promptTemplate: string
  readonly parameters?: Record<string, string>
  readonly enabled?: boolean
  readonly timezone?: string
  readonly rule: RoutineRule
  readonly quietHours?: ScheduleWindow
  readonly window?: ScheduleWindow
  readonly maxRuns?: number
  readonly mode?: RoutineMode
  readonly workspaceCwd?: string
  readonly preset?: string
  readonly event?: EventTrigger
  readonly grind?: GrindSettings
}

export interface UpdateRoutineInput {
  readonly title?: string
  readonly promptTemplate?: string
  readonly parameters?: Record<string, string>
  readonly timezone?: string
  readonly rule?: RoutineRule
  readonly quietHours?: ScheduleWindow | null
  readonly window?: ScheduleWindow | null
  readonly maxRuns?: number | null
  readonly mode?: RoutineMode
  readonly workspaceCwd?: string | null
  readonly preset?: string | null
  readonly event?: EventTrigger | null
  readonly grind?: GrindSettings | null
}

export const RUN_HISTORY_CAP = 40

export class RoutineError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'RoutineError'
  }
}
