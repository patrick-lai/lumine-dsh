import { defaultTimeZone, foundationWeekday, fromZonedTime, startOfZonedDay, addZonedDays, zonedParts } from './timezone.ts'
import type { ActiveRun, Routine, RoutineRule, ScheduleWindow } from './types.ts'
import { RoutineError } from './types.ts'

export class CronError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CronError'
  }
}

export interface CronExpression {
  readonly raw: string
  readonly minutes: ReadonlySet<number>
  readonly hours: ReadonlySet<number>
  readonly daysOfMonth: ReadonlySet<number>
  readonly months: ReadonlySet<number>
  readonly weekdays: ReadonlySet<number>
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const WEEKDAY_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

function parseCronField(raw: string, min: number, max: number, names: Record<string, number>): Set<number> {
  const result = new Set<number>()
  for (const part of raw.toLowerCase().split(',')) {
    const stepParts = part.split('/')
    const base = stepParts[0] ?? ''
    const step = stepParts.length === 2 ? Number(stepParts[1]) : undefined
    if ((step ?? 1) <= 0 || (step !== undefined && !Number.isInteger(step))) {
      throw new CronError(`invalid cron field '${raw}'`)
    }
    let lo: number
    let hi: number
    if (base === '*') {
      lo = min
      hi = max
    } else if (base.includes('-')) {
      const bounds = base.split('-')
      const start = valueOf(bounds[0] ?? '', names)
      const end = valueOf(bounds[1] ?? '', names)
      if (start === undefined || end === undefined || start > end) {
        throw new CronError(`invalid cron field '${raw}'`)
      }
      lo = start
      hi = end
    } else {
      const single = valueOf(base, names)
      if (single === undefined) throw new CronError(`invalid cron field '${raw}'`)
      lo = single
      hi = single
    }
    if (lo < min || hi > max) throw new CronError(`invalid cron field '${raw}'`)
    const stride = step ?? 1
    for (let value = lo; value <= hi; value += stride) result.add(value)
  }
  return result
}

function valueOf(raw: string, names: Record<string, number>): number | undefined {
  if (raw in names) return names[raw]
  const parsed = Number(raw)
  return Number.isInteger(parsed) ? parsed : undefined
}

export function parseCron(raw: string): CronExpression {
  const fields = raw.trim().split(/[ \t]+/).filter(Boolean)
  if (fields.length !== 5) {
    throw new CronError('cron expression must have five fields: minute hour day-of-month month day-of-week')
  }
  const weekdays = new Set<number>()
  for (const value of parseCronField(fields[4] ?? '', 0, 7, WEEKDAY_NAMES)) {
    weekdays.add(value === 7 ? 0 : value)
  }
  return {
    raw,
    minutes: parseCronField(fields[0] ?? '', 0, 59, {}),
    hours: parseCronField(fields[1] ?? '', 0, 23, {}),
    daysOfMonth: parseCronField(fields[2] ?? '', 1, 31, {}),
    months: parseCronField(fields[3] ?? '', 1, 12, MONTH_NAMES),
    weekdays,
  }
}

export function cronMatches(cron: CronExpression, date: Date, timeZone: string): boolean {
  const parts = zonedParts(date, timeZone)
  return cron.minutes.has(parts.minute)
    && cron.hours.has(parts.hour)
    && cron.daysOfMonth.has(parts.day)
    && cron.months.has(parts.month)
    && cron.weekdays.has(parts.weekday)
}

export function cronNext(cron: CronExpression, after: Date, timeZone: string, window?: ScheduleWindow): Date | undefined {
  const zone = window?.timeZoneIdentifier || timeZone
  const hours = [...cron.hours].sort((a, b) => a - b)
  const minutes = [...cron.minutes].sort((a, b) => a - b)
  let dayStart = startOfZonedDay(after, zone)
  for (let index = 0; index < 366 * 5; index += 1) {
    const parts = zonedParts(dayStart, zone)
    if (cron.daysOfMonth.has(parts.day) && cron.months.has(parts.month) && cron.weekdays.has(parts.weekday)) {
      for (const hour of hours) {
        for (const minute of minutes) {
          const candidate = fromZonedTime(zone, parts.year, parts.month, parts.day, hour, minute, 0)
          if (
            candidate
            && candidate.getTime() > after.getTime()
            && cronMatches(cron, candidate, zone)
            && (window === undefined || windowContains(window, candidate))
          ) {
            return candidate
          }
        }
      }
    }
    const nextDay = addZonedDays(dayStart, zone, 1)
    if (nextDay === undefined) return undefined
    dayStart = nextDay
  }
  return undefined
}

export function parseClock(raw: string): number | undefined {
  const parts = raw.trim().split(':')
  if (parts.length !== 2) return undefined
  const hour = Number(parts[0])
  const minute = Number(parts[1])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined
  return hour * 60 + minute
}

export function parseWeekday(raw: string): number | undefined {
  switch (raw.trim().toLowerCase()) {
    case 'sun': case 'sunday': case '0': case '7': return 1
    case 'mon': case 'monday': case '1': return 2
    case 'tue': case 'tues': case 'tuesday': case '2': return 3
    case 'wed': case 'wednesday': case '3': return 4
    case 'thu': case 'thur': case 'thurs': case 'thursday': case '4': return 5
    case 'fri': case 'friday': case '5': return 6
    case 'sat': case 'saturday': case '6': return 7
    default: return undefined
  }
}

function minuteInRange(minute: number, start: number, end: number): boolean {
  if (start === end) return true
  if (start < end) return minute >= start && minute < end
  return minute >= start || minute < end
}

export function windowContains(window: ScheduleWindow, date: Date): boolean {
  const zone = window.timeZoneIdentifier || defaultTimeZone()
  const parts = zonedParts(date, zone)
  const weekday = foundationWeekday(parts.weekday)
  const minute = parts.hour * 60 + parts.minute
  const weekdayMinutes = window.weekdayMinutes
  if (weekdayMinutes && Object.keys(weekdayMinutes).length > 0) {
    const pair = weekdayMinutes[String(weekday)]
    if (pair && pair.length >= 2) {
      const start = pair[0] ?? 0
      const end = pair[1] ?? 0
      if (start < end) {
        if (minute >= start && minute < end) return true
      } else if (start === end) {
        return true
      } else if (minute >= start) {
        return true
      }
    }
    const yesterday = weekday === 1 ? 7 : weekday - 1
    const yesterdayPair = weekdayMinutes[String(yesterday)]
    if (yesterdayPair && yesterdayPair.length >= 2 && (yesterdayPair[0] ?? 0) > (yesterdayPair[1] ?? 0)) {
      return minute < (yesterdayPair[1] ?? 0)
    }
    return false
  }
  if (window.weekdays && window.weekdays.length > 0 && !window.weekdays.includes(weekday)) return false
  if (window.startMinute === undefined || window.endMinute === undefined) return true
  return minuteInRange(minute, window.startMinute, window.endMinute)
}

function windowEndMinute(window: ScheduleWindow, day: Date, zone: string): number | undefined {
  if (window.weekdayMinutes && Object.keys(window.weekdayMinutes).length > 0) {
    const weekday = foundationWeekday(zonedParts(day, zone).weekday)
    const pair = window.weekdayMinutes[String(weekday)]
    if (!pair || pair.length < 2) return undefined
    return pair[1]
  }
  return window.endMinute
}

function wrappingEndFromYesterday(window: ScheduleWindow, day: Date, zone: string): number | undefined {
  if (!window.weekdayMinutes || Object.keys(window.weekdayMinutes).length === 0) return undefined
  const weekday = foundationWeekday(zonedParts(day, zone).weekday)
  const yesterday = weekday === 1 ? 7 : weekday - 1
  const pair = window.weekdayMinutes[String(yesterday)]
  if (!pair || pair.length < 2 || (pair[0] ?? 0) <= (pair[1] ?? 0)) return undefined
  return pair[1]
}

export function windowNextExit(window: ScheduleWindow, after: Date): Date | undefined {
  const zone = window.timeZoneIdentifier || defaultTimeZone()
  let day = startOfZonedDay(after, zone)
  for (let offset = 0; offset <= 370; offset += 1) {
    const parts = zonedParts(day, zone)
    const boundaries: Date[] = [day]
    const end = windowEndMinute(window, day, zone)
    if (end !== undefined) {
      const stamp = fromZonedTime(zone, parts.year, parts.month, parts.day, Math.floor(end / 60), end % 60, 0)
      if (stamp) boundaries.push(stamp)
    }
    const wrapEnd = wrappingEndFromYesterday(window, day, zone)
    if (wrapEnd !== undefined) {
      const stamp = fromZonedTime(zone, parts.year, parts.month, parts.day, Math.floor(wrapEnd / 60), wrapEnd % 60, 0)
      if (stamp) boundaries.push(stamp)
    }
    for (const boundary of boundaries.sort((a, b) => a.getTime() - b.getTime())) {
      if (boundary.getTime() <= after.getTime()) continue
      if (windowContains(window, new Date(boundary.getTime() - 1)) && !windowContains(window, boundary)) {
        return boundary
      }
    }
    const next = addZonedDays(day, zone, 1)
    if (next === undefined) return undefined
    day = next
  }
  return undefined
}

export function windowNextStart(window: ScheduleWindow, after: Date): Date | undefined {
  const zone = window.timeZoneIdentifier || defaultTimeZone()
  let day = startOfZonedDay(after, zone)
  for (let offset = 0; offset <= 370; offset += 1) {
    const parts = zonedParts(day, zone)
    const weekday = foundationWeekday(parts.weekday)
    let start: number
    if (window.weekdayMinutes && Object.keys(window.weekdayMinutes).length > 0) {
      const pair = window.weekdayMinutes[String(weekday)]
      if (!pair || pair.length < 2) {
        const next = addZonedDays(day, zone, 1)
        if (next === undefined) return undefined
        day = next
        continue
      }
      start = pair[0] ?? 0
    } else {
      if (window.weekdays && window.weekdays.length > 0 && !window.weekdays.includes(weekday)) {
        const next = addZonedDays(day, zone, 1)
        if (next === undefined) return undefined
        day = next
        continue
      }
      start = window.startMinute ?? 0
    }
    const candidate = fromZonedTime(zone, parts.year, parts.month, parts.day, Math.floor(start / 60), start % 60, 0)
    if (candidate && candidate.getTime() > after.getTime()) return candidate
    if (windowContains(window, after)) return after
    const next = addZonedDays(day, zone, 1)
    if (next === undefined) return undefined
    day = next
  }
  return undefined
}

export function ruleNext(
  rule: RoutineRule,
  after: Date,
  createdAt: number,
  lastRunAt: number | undefined,
  window: ScheduleWindow | undefined,
  timeZone: string,
): Date | undefined {
  switch (rule.kind) {
    case 'manual':
      return undefined
    case 'once': {
      const at = new Date(rule.at)
      return at.getTime() > after.getTime() && (window === undefined || windowContains(window, at)) ? at : undefined
    }
    case 'cron':
      return cronNext(parseCron(rule.cron), after, timeZone, window)
    case 'interval': {
      if (!(rule.seconds > 0)) return undefined
      const anchor = lastRunAt ?? createdAt
      let n = Math.max(1, Math.floor((after.getTime() - anchor) / (rule.seconds * 1000)) + 1)
      const limit = n + 20_000
      while (n <= limit) {
        const candidate = new Date(anchor + n * rule.seconds * 1000)
        if (candidate.getTime() > after.getTime() && (window === undefined || windowContains(window, candidate))) {
          return candidate
        }
        n += 1
      }
      if (window === undefined) return undefined
      const start = windowNextStart(window, after)
      if (start === undefined) return undefined
      const aligned = Math.max(1, Math.ceil((start.getTime() - anchor) / (rule.seconds * 1000)))
      const candidate = new Date(anchor + aligned * rule.seconds * 1000)
      if (candidate.getTime() >= start.getTime() && windowContains(window, candidate)) return candidate
      return undefined
    }
    default:
      return undefined
  }
}

export function nextRun(routine: Pick<Routine, 'enabled' | 'maxRuns' | 'runCount' | 'quietHours' | 'rule' | 'createdAt' | 'lastRunAt' | 'window' | 'timezone'>, after: Date): Date | undefined {
  if (!routine.enabled) return undefined
  if (routine.maxRuns !== undefined && routine.runCount >= routine.maxRuns) return undefined
  const zone = routine.timezone || defaultTimeZone()
  if (!routine.quietHours) {
    return ruleNext(routine.rule, after, routine.createdAt, routine.lastRunAt, routine.window, zone)
  }
  let cursor = after
  for (let index = 0; index < 370; index += 1) {
    const candidate = ruleNext(routine.rule, cursor, routine.createdAt, routine.lastRunAt, routine.window, zone)
    if (candidate === undefined) return undefined
    if (!windowContains(routine.quietHours, candidate)) return candidate
    const exit = windowNextExit(routine.quietHours, candidate)
    if (exit === undefined) return undefined
    cursor = new Date(exit.getTime() - 1)
  }
  return undefined
}

export function isHeldByQuietHours(routine: Pick<Routine, 'quietHours'>, at: Date): boolean {
  return routine.quietHours ? windowContains(routine.quietHours, at) : false
}

export function isActiveRunBlocking(
  activeRun: ActiveRun | undefined,
  now: Date,
  staleAfterMs?: number,
): boolean {
  if (!activeRun) return false
  if (staleAfterMs !== undefined && staleAfterMs > 0 && now.getTime() - activeRun.startedAt >= staleAfterMs) {
    return false
  }
  return true
}

export function shouldFire(
  routine: Pick<Routine, 'enabled' | 'nextRunAt' | 'activeRun'>,
  now: Date,
  staleAfterMs?: number,
): boolean {
  if (!routine.enabled || routine.nextRunAt === undefined || routine.nextRunAt > now.getTime()) return false
  return !isActiveRunBlocking(routine.activeRun, now, staleAfterMs)
}

/**
 * Occurrences strictly after the overdue `nextRunAt` and at-or-before `now`.
 * The due fire itself is not counted — catch-up still fires exactly once.
 */
export function missedFireCount(
  routine: Pick<Routine, 'nextRunAt' | 'rule' | 'createdAt' | 'window' | 'timezone'>,
  now: Date,
  cap = 500,
): number {
  if (routine.nextRunAt === undefined || routine.nextRunAt > now.getTime() || cap <= 0) return 0
  let count = 0
  let last = routine.nextRunAt
  const zone = routine.timezone || defaultTimeZone()
  while (count < cap) {
    const next = ruleNext(routine.rule, new Date(last), routine.createdAt, last, routine.window, zone)
    if (next === undefined || next.getTime() > now.getTime()) break
    count += 1
    last = next.getTime()
  }
  return count
}

export function beginRun(now = Date.now(), id = crypto.randomUUID()): ActiveRun {
  return { id, startedAt: now }
}

export function endRunMatches(active: ActiveRun | undefined, id: string): boolean {
  return active?.id === id
}

export function assertRule(rule: RoutineRule): RoutineRule {
  switch (rule.kind) {
    case 'manual':
      return { kind: 'manual' }
    case 'once':
      if (!Number.isFinite(rule.at)) throw new RoutineError('once rule requires a finite at timestamp', 'ROUTINE_INVALID_RULE')
      return { kind: 'once', at: rule.at }
    case 'interval':
      if (!(rule.seconds > 0)) throw new RoutineError('interval rule requires seconds > 0', 'ROUTINE_INVALID_RULE')
      return { kind: 'interval', seconds: rule.seconds }
    case 'cron':
      parseCron(rule.cron)
      return { kind: 'cron', cron: rule.cron.trim() }
    default:
      throw new RoutineError('unknown routine rule', 'ROUTINE_INVALID_RULE')
  }
}

export function renderTemplate(template: string, parameters: Record<string, string>, extras: Record<string, string> = {}): string {
  const values = { ...parameters, ...extras }
  const lookup = (_match: string, key: string): string => values[key] ?? values[key.toUpperCase()] ?? values[key.toLowerCase()] ?? _match
  return template
    .replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, lookup)
    .replace(/\$\{\s*([A-Za-z0-9_]+)\s*\}/g, lookup)
    .replace(/\{([A-Za-z0-9_]+)\}/g, lookup)
}

export function normalizeEventName(raw: string): string | undefined {
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return undefined
  let normalized = ''
  let previousWasSeparator = false
  for (const char of trimmed) {
    const code = char.codePointAt(0) ?? 0
    if (/\s/.test(char)) {
      if (!previousWasSeparator) {
        normalized += '-'
        previousWasSeparator = true
      }
      continue
    }
    const isLetter = code >= 97 && code <= 122
    const isDigit = code >= 48 && code <= 57
    const isSeparator = char === '.' || char === '_' || char === '-'
    if (!isLetter && !isDigit && !isSeparator) continue
    if (isSeparator) {
      if (previousWasSeparator) continue
      previousWasSeparator = true
    } else {
      previousWasSeparator = false
    }
    normalized += char
  }
  const capped = normalized.slice(0, 64)
  return capped.length === 0 ? undefined : capped
}
