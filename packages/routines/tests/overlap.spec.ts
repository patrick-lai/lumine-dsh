import { describe, expect, it } from 'vitest'
import { beginRun, endRunMatches, isActiveRunBlocking, shouldFire } from '../src/calendar.ts'

describe('overlap guard', () => {
  const now = new Date('2026-01-01T01:00:00Z')

  it('blocks a new launch while a run is in flight', () => {
    const run = beginRun(Date.parse('2026-01-01T00:59:00Z'), 'token-1')
    expect(isActiveRunBlocking(run, now, 21_600_000)).toBe(true)
    expect(shouldFire({
      enabled: true,
      nextRunAt: Date.parse('2026-01-01T00:30:00Z'),
      activeRun: run,
    }, now, 21_600_000)).toBe(false)
  })

  it('frees a stale in-flight token so a crashed run cannot silence the routine', () => {
    const run = beginRun(Date.parse('2025-12-31T12:00:00Z'), 'token-old')
    expect(isActiveRunBlocking(run, now, 3_600_000)).toBe(false)
    expect(shouldFire({
      enabled: true,
      nextRunAt: Date.parse('2026-01-01T00:30:00Z'),
      activeRun: run,
    }, now, 3_600_000)).toBe(true)
  })

  it('clears only the token that still owns the run', () => {
    const first = beginRun(Date.parse('2026-01-01T00:00:00Z'), 'first')
    const second = beginRun(Date.parse('2026-01-01T00:50:00Z'), 'second')
    expect(endRunMatches(second, 'first')).toBe(false)
    expect(endRunMatches(second, 'second')).toBe(true)
    expect(endRunMatches(first, 'first')).toBe(true)
  })

  it('does not block when no run is active', () => {
    expect(isActiveRunBlocking(undefined, now, 1000)).toBe(false)
  })
})
