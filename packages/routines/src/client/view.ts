import { nextRun } from '../calendar.ts'
import type { CreateRoutineInput, Routine, RoutineRule, ScheduleWindow, UpdateRoutineInput } from '../types.ts'

export type CadenceKind = RoutineRule['kind']

/** Patrick-facing default when a new row has no zone yet. Existing rows keep theirs. */
export const DEFAULT_OPERATOR_ZONE = 'Australia/Sydney'

export const WEEKDAY_LABELS = [
  { id: 1, label: 'Sun' },
  { id: 2, label: 'Mon' },
  { id: 3, label: 'Tue' },
  { id: 4, label: 'Wed' },
  { id: 5, label: 'Thu' },
  { id: 6, label: 'Fri' },
  { id: 7, label: 'Sat' },
] as const

export const IANA_ZONES = [
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Brisbane',
  'Australia/Perth',
  'Pacific/Auckland',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
] as const

export interface RoutineRowView {
  readonly id: string
  readonly title: string
  readonly cadence: string
  readonly enabled: boolean
  readonly status: 'on' | 'paused'
  readonly timezone: string
  readonly nextRunAt?: number
  readonly lastError?: string
}

export interface RoutineDraft {
  readonly title: string
  readonly prompt: string
  readonly kind: CadenceKind
  readonly at: string
  readonly seconds: string
  readonly cron: string
  readonly timezone: string
  readonly quietEnabled: boolean
  readonly quietStart: string
  readonly quietEnd: string
  readonly quietWeekdays: readonly number[]
  readonly maxRuns: string
}

export function emptyDraft(): RoutineDraft {
  return {
    title: '',
    prompt: '',
    kind: 'cron',
    at: '',
    seconds: '300',
    cron: '0 9 * * 1-5',
    timezone: DEFAULT_OPERATOR_ZONE,
    quietEnabled: false,
    quietStart: '22:00',
    quietEnd: '07:00',
    quietWeekdays: [1, 2, 3, 4, 5, 6, 7],
    maxRuns: '',
  }
}

export function minutesToClock(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440
  const hour = Math.floor(wrapped / 60)
  const minute = wrapped % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function clockToMinutes(raw: string): number | undefined {
  const parts = raw.trim().split(':')
  if (parts.length < 2) return undefined
  const hour = Number(parts[0])
  const minute = Number(parts[1])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined
  return hour * 60 + minute
}

export function draftFromRoutine(routine: Routine): RoutineDraft {
  const quiet = routine.quietHours
  const start = quiet?.startMinute
  const end = quiet?.endMinute
  return {
    title: routine.title,
    prompt: routine.promptTemplate,
    kind: routine.rule.kind,
    at: routine.rule.kind === 'once' && Number.isFinite(routine.rule.at)
      ? datetimeLocal(routine.rule.at)
      : '',
    seconds: routine.rule.kind === 'interval' ? String(routine.rule.seconds) : '300',
    cron: routine.rule.kind === 'cron' ? routine.rule.cron : '0 9 * * 1-5',
    timezone: routine.timezone.trim() || DEFAULT_OPERATOR_ZONE,
    quietEnabled: quiet !== undefined,
    quietStart: start === undefined ? '22:00' : minutesToClock(start),
    quietEnd: end === undefined ? '07:00' : minutesToClock(end),
    quietWeekdays: quiet?.weekdays && quiet.weekdays.length > 0
      ? [...quiet.weekdays]
      : [1, 2, 3, 4, 5, 6, 7],
    maxRuns: routine.maxRuns === undefined ? '' : String(routine.maxRuns),
  }
}

function datetimeLocal(at: number): string {
  const date = new Date(at)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function cadenceSummary(rule: RoutineRule): string {
  if (rule.kind === 'manual') return 'manual'
  if (rule.kind === 'once') {
    const when = Number.isFinite(rule.at) ? new Date(rule.at).toISOString() : 'unset'
    return `once at ${when}`
  }
  if (rule.kind === 'interval') {
    const seconds = rule.seconds
    if (seconds % 3600 === 0 && seconds >= 3600) {
      const hours = seconds / 3600
      return hours === 1 ? 'every 1 hour' : `every ${hours} hours`
    }
    if (seconds % 60 === 0 && seconds >= 60) {
      const minutes = seconds / 60
      return minutes === 1 ? 'every 1 minute' : `every ${minutes} minutes`
    }
    return seconds === 1 ? 'every 1 second' : `every ${seconds} seconds`
  }
  return `cron ${rule.cron}`
}

export function lastError(routine: Pick<Routine, 'deliveryFailures' | 'runs'>): string | undefined {
  if (routine.deliveryFailures <= 0) return undefined
  const note = routine.runs.at(-1)?.note?.trim()
  return note || 'delivery failed'
}

export function rowView(routine: Routine): RoutineRowView {
  return {
    id: routine.id,
    title: routine.title,
    cadence: cadenceSummary(routine.rule),
    enabled: routine.enabled,
    status: routine.enabled ? 'on' : 'paused',
    timezone: routine.timezone.trim() || DEFAULT_OPERATOR_ZONE,
    ...routine.nextRunAt !== undefined ? { nextRunAt: routine.nextRunAt } : {},
    ...(() => {
      const error = lastError(routine)
      return error === undefined ? {} : { lastError: error }
    })(),
  }
}

export function formatNextRun(at: number, timeZone = DEFAULT_OPERATOR_ZONE): string {
  const date = new Date(at)
  if (!Number.isFinite(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date)
  } catch {
    return date.toISOString()
  }
}

export function draftRule(draft: RoutineDraft): RoutineRule | undefined {
  if (draft.kind === 'manual') return { kind: 'manual' }
  if (draft.kind === 'interval') {
    const seconds = Number(draft.seconds)
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined
    return { kind: 'interval', seconds: Math.floor(seconds) }
  }
  if (draft.kind === 'cron') {
    const cron = draft.cron.trim()
    if (cron.split(/\s+/).length !== 5) return undefined
    return { kind: 'cron', cron }
  }
  const at = Date.parse(draft.at)
  if (!Number.isFinite(at)) return undefined
  return { kind: 'once', at }
}

export function draftTimezone(draft: Pick<RoutineDraft, 'timezone'>): string {
  return draft.timezone.trim() || DEFAULT_OPERATOR_ZONE
}

export function draftQuietHours(draft: RoutineDraft): ScheduleWindow | undefined {
  if (!draft.quietEnabled) return undefined
  const startMinute = clockToMinutes(draft.quietStart)
  const endMinute = clockToMinutes(draft.quietEnd)
  if (startMinute === undefined || endMinute === undefined) return undefined
  const weekdays = [...draft.quietWeekdays].filter(day => day >= 1 && day <= 7).sort((a, b) => a - b)
  return {
    timeZoneIdentifier: draftTimezone(draft),
    startMinute,
    endMinute,
    ...weekdays.length > 0 ? { weekdays } : {},
  }
}

export function draftMaxRuns(draft: RoutineDraft): number | undefined {
  const raw = draft.maxRuns.trim()
  if (!raw) return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) return undefined
  return value
}

export function draftReady(draft: RoutineDraft): boolean {
  return draft.title.trim().length > 0
    && draft.prompt.trim().length > 0
    && draftRule(draft) !== undefined
    && (!draft.quietEnabled || draftQuietHours(draft) !== undefined)
}

export function toCreateInput(draft: RoutineDraft): CreateRoutineInput | undefined {
  const rule = draftRule(draft)
  if (rule === undefined || !draftReady(draft)) return undefined
  const quietHours = draftQuietHours(draft)
  const maxRuns = draftMaxRuns(draft)
  return {
    title: draft.title.trim(),
    promptTemplate: draft.prompt.trim(),
    timezone: draftTimezone(draft),
    rule,
    ...quietHours ? { quietHours } : {},
    ...maxRuns !== undefined ? { maxRuns } : {},
  }
}

export function toUpdateInput(draft: RoutineDraft): UpdateRoutineInput | undefined {
  const created = toCreateInput(draft)
  if (created === undefined) return undefined
  return {
    title: created.title,
    promptTemplate: created.promptTemplate,
    timezone: created.timezone,
    rule: created.rule,
    quietHours: created.quietHours ?? null,
    maxRuns: created.maxRuns ?? null,
  }
}

export function previewNextRun(draft: RoutineDraft, now = Date.now()): number | undefined {
  const rule = draftRule(draft)
  if (rule === undefined || rule.kind === 'manual') return undefined
  try {
    const quietHours = draftQuietHours(draft)
    const maxRuns = draftMaxRuns(draft)
    const at = nextRun({
      enabled: true,
      timezone: draftTimezone(draft),
      rule,
      createdAt: now,
      runCount: 0,
      ...quietHours ? { quietHours } : {},
      ...maxRuns !== undefined ? { maxRuns } : {},
    }, new Date(now))
    return at?.getTime()
  } catch {
    return undefined
  }
}
