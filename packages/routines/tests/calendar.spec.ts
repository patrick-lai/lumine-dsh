import { describe, expect, it } from 'vitest'
import {
  cronNext,
  isHeldByQuietHours,
  missedFireCount,
  nextRun,
  parseCron,
  parseClock,
  ruleNext,
  shouldFire,
  windowContains,
} from '../src/calendar.ts'
import type { Routine } from '../src/types.ts'

const TZ = 'UTC'

function at(iso: string): Date {
  return new Date(iso)
}

function routine(partial: Partial<Routine> & Pick<Routine, 'rule'>): Routine {
  return {
    id: 'r1',
    title: 't',
    promptTemplate: 'do the thing',
    parameters: {},
    enabled: true,
    timezone: TZ,
    mode: 'cron',
    createdAt: Date.parse('2026-01-01T00:00:00Z'),
    updatedAt: Date.parse('2026-01-01T00:00:00Z'),
    runCount: 0,
    runs: [],
    ...partial,
  }
}

describe('cron next-run', () => {
  it('parses five fields and finds the next weekday 09:00', () => {
    const cron = parseCron('0 9 * * 1-5')
    const next = cronNext(cron, at('2026-08-28T08:00:00Z'), TZ)
    expect(next?.toISOString()).toBe('2026-08-28T09:00:00.000Z')
  })

  it('skips Saturday when the expression is weekdays only', () => {
    const cron = parseCron('0 9 * * 1-5')
    const next = cronNext(cron, at('2026-08-28T10:00:00Z'), TZ)
    expect(next?.toISOString()).toBe('2026-08-31T09:00:00.000Z')
  })

  it('accepts names and 7 as Sunday', () => {
    const cron = parseCron('30 6 1 jan sun,7')
    expect(cron.minutes.has(30)).toBe(true)
    expect(cron.hours.has(6)).toBe(true)
    expect(cron.months.has(1)).toBe(true)
    expect(cron.weekdays.has(0)).toBe(true)
    expect(cron.weekdays.has(7)).toBe(false)
  })

  it('rejects a four-field expression', () => {
    expect(() => parseCron('0 9 * *')).toThrow(/five fields/)
  })
})

describe('interval and once', () => {
  it('aligns intervals to createdAt when never fired', () => {
    const createdAt = Date.parse('2026-01-01T00:00:00Z')
    const next = ruleNext(
      { kind: 'interval', seconds: 3600 },
      at('2026-01-01T00:30:00Z'),
      createdAt,
      undefined,
      undefined,
      TZ,
    )
    expect(next?.toISOString()).toBe('2026-01-01T01:00:00.000Z')
  })

  it('re-anchors an interval on lastRunAt', () => {
    const next = ruleNext(
      { kind: 'interval', seconds: 60 },
      at('2026-01-01T00:00:30Z'),
      Date.parse('2026-01-01T00:00:00Z'),
      Date.parse('2026-01-01T00:00:10Z'),
      undefined,
      TZ,
    )
    expect(next?.toISOString()).toBe('2026-01-01T00:01:10.000Z')
  })

  it('returns a future once and nothing after it', () => {
    const atOnce = Date.parse('2026-02-01T12:00:00Z')
    expect(ruleNext({ kind: 'once', at: atOnce }, at('2026-01-15T00:00:00Z'), 0, undefined, undefined, TZ)?.toISOString())
      .toBe('2026-02-01T12:00:00.000Z')
    expect(ruleNext({ kind: 'once', at: atOnce }, at('2026-02-01T12:00:00Z'), 0, undefined, undefined, TZ)).toBeUndefined()
  })

  it('never schedules a manual rule', () => {
    expect(ruleNext({ kind: 'manual' }, at('2026-01-01T00:00:00Z'), 0, undefined, undefined, TZ)).toBeUndefined()
  })
})

describe('quiet hours and windows', () => {
  it('holds a candidate inside quiet hours and resumes after the exit', () => {
    const scheduled = routine({
      rule: { kind: 'cron', cron: '* * * * *' },
      quietHours: { startMinute: parseClock('22:00'), endMinute: parseClock('07:00'), timeZoneIdentifier: TZ },
    })
    const next = nextRun(scheduled, at('2026-08-28T22:30:00Z'))
    expect(next?.toISOString()).toBe('2026-08-29T07:00:00.000Z')
    expect(isHeldByQuietHours(scheduled, at('2026-08-28T23:00:00Z'))).toBe(true)
    expect(isHeldByQuietHours(scheduled, at('2026-08-29T08:00:00Z'))).toBe(false)
  })

  it('restricts an active window to weekdays 09:00-17:00', () => {
    const window = {
      weekdays: [2, 3, 4, 5, 6],
      startMinute: parseClock('09:00'),
      endMinute: parseClock('17:00'),
      timeZoneIdentifier: TZ,
    }
    expect(windowContains(window, at('2026-08-28T10:00:00Z'))).toBe(true)
    expect(windowContains(window, at('2026-08-28T08:00:00Z'))).toBe(false)
    expect(windowContains(window, at('2026-08-29T10:00:00Z'))).toBe(false)
    const next = nextRun(routine({
      rule: { kind: 'cron', cron: '0 * * * *' },
      window,
    }), at('2026-08-28T16:30:00Z'))
    expect(next?.toISOString()).toBe('2026-08-31T09:00:00.000Z')
  })

  it('stops scheduling after maxRuns', () => {
    const next = nextRun(routine({
      rule: { kind: 'interval', seconds: 60 },
      maxRuns: 2,
      runCount: 2,
    }), at('2026-01-01T00:00:00Z'))
    expect(next).toBeUndefined()
  })
})

describe('catch-up-once', () => {
  it('counts collapsed fires after the overdue slot and still treats the due fire as one launch', () => {
    const due = routine({
      rule: { kind: 'interval', seconds: 60 },
      createdAt: Date.parse('2026-01-01T00:00:00Z'),
      nextRunAt: Date.parse('2026-01-01T00:01:00Z'),
    })
    const now = at('2026-01-01T00:05:00Z')
    expect(missedFireCount(due, now)).toBe(4)
    expect(shouldFire(due, now)).toBe(true)
    expect(shouldFire({ ...due, enabled: false }, now)).toBe(false)
  })
})
