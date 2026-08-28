import { describe, expect, it } from 'vitest'
import { cadenceSummary, draftReady, draftRule, emptyDraft, lastError, rowView } from '../src/client/view.ts'
import { en } from '../src/client/locales.ts'

describe('routines settings copy and cadence', () => {
  it('uses the Routines title and a one-line empty state without marketing chrome', () => {
    expect(en.nav).toBe('Routines')
    expect(en.empty).toBe('No routines yet.')
    expect(en.nav).not.toMatch(/Automation|Schedule/)
    const visible = Object.values(en).join(' ')
    expect(visible).not.toMatch(/—/)
    expect(visible).not.toMatch(/Inter|Lucide/)
  })

  it('summarizes clock kinds without inventing nextRunAt', () => {
    expect(cadenceSummary({ kind: 'manual' })).toBe('manual')
    expect(cadenceSummary({ kind: 'interval', seconds: 300 })).toBe('every 5 minutes')
    expect(cadenceSummary({ kind: 'cron', cron: '0 9 * * 1' })).toBe('cron 0 9 * * 1')
    expect(cadenceSummary({ kind: 'once', at: Date.parse('2026-01-01T00:00:00Z') })).toMatch(/^once at /)
    const row = rowView({
      id: 'r1',
      title: 'nightly',
      promptTemplate: 'ping',
      parameters: {},
      enabled: false,
      timezone: 'UTC',
      rule: { kind: 'manual' },
      mode: 'cron',
      createdAt: 1,
      updatedAt: 1,
      runCount: 0,
      deliveryFailures: 0,
      runs: [],
    })
    expect(row.status).toBe('paused')
    expect('nextRunAt' in row).toBe(false)
    expect('lastError' in row).toBe(false)
  })

  it('surfaces the last failed run note only while deliveryFailures is set', () => {
    expect(lastError({ deliveryFailures: 0, runs: [{ id: 'a', startedAt: 1, note: 'delivery failed' }] })).toBeUndefined()
    expect(lastError({ deliveryFailures: 2, runs: [{ id: 'a', startedAt: 1, note: 'retry 2/3' }] })).toBe('retry 2/3')
  })

  it('builds a paused create payload from the compact draft', () => {
    const draft = { ...emptyDraft(), title: 'ping', prompt: 'hello', kind: 'interval' as const, seconds: '90' }
    expect(draftReady(draft)).toBe(true)
    expect(draftRule(draft)).toEqual({ kind: 'interval', seconds: 90 })
    expect(draftReady(emptyDraft())).toBe(false)
  })
})
