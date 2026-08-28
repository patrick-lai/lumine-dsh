/** Local civil-time parts in an IANA zone. weekday is JS/cron Sunday=0. */
export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: number
}

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
}

function part(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find(entry => entry.type === type)?.value ?? ''
}

export function defaultTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const weekdayName = part(parts, 'weekday').toLowerCase()
  return {
    year: Number(part(parts, 'year')),
    month: Number(part(parts, 'month')),
    day: Number(part(parts, 'day')),
    hour: Number(part(parts, 'hour')),
    minute: Number(part(parts, 'minute')),
    second: Number(part(parts, 'second')),
    weekday: WEEKDAY_INDEX[weekdayName] ?? 0,
  }
}

/** Foundation weekday: 1=Sunday … 7=Saturday. */
export function foundationWeekday(jsWeekday: number): number {
  return jsWeekday + 1
}

/**
 * Instant that shows as the given wall clock in `timeZone`.
 * Spring-forward gaps do not match; caller must reject rolled results.
 */
export function fromZonedTime(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date | undefined {
  const want = Date.UTC(year, month - 1, day, hour, minute, second)
  let guess = want
  for (let index = 0; index < 4; index += 1) {
    const got = zonedParts(new Date(guess), timeZone)
    const gotUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second)
    const delta = want - gotUtc
    if (delta === 0) {
      const check = zonedParts(new Date(guess), timeZone)
      if (
        check.year === year && check.month === month && check.day === day
        && check.hour === hour && check.minute === minute && check.second === second
      ) {
        return new Date(guess)
      }
      return undefined
    }
    guess += delta
  }
  return undefined
}

export function startOfZonedDay(date: Date, timeZone: string): Date {
  const parts = zonedParts(date, timeZone)
  return fromZonedTime(timeZone, parts.year, parts.month, parts.day, 0, 0, 0) ?? new Date(date)
}

export function addZonedDays(dayStart: Date, timeZone: string, days: number): Date | undefined {
  const parts = zonedParts(dayStart, timeZone)
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0)
  const noon = zonedParts(new Date(utc), timeZone)
  return fromZonedTime(timeZone, noon.year, noon.month, noon.day, 0, 0, 0)
}
