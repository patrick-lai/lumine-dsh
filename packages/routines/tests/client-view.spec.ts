import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPERATOR_ZONE,
  cadenceSummary,
  draftFromRoutine,
  draftQuietHours,
  draftReady,
  draftRule,
  emptyDraft,
  lastError,
  previewNextRun,
  rowView,
  toCreateInput,
} from '../src/client/view.ts'
import { en } from '../src/client/locales.ts'

describe('routines rail copy and cadence', () => {
  it('uses the Routines title and a one-line empty state without marketing chrome', () => {
    expect(en.nav).toBe('Routines')
    expect(en.empty).toBe('No routines yet.')
    expect(en.settingsHint).toBe('Routines live on the left rail.')
    expect(en.nav).not.toMatch(/Automation|Schedule/)
    const visible = Object.values(en).join(' ')
    expect(visible).not.toMatch(/—/)
    expect(visible).not.toMatch(/Inter|Lucide/)
  })

  it('defaults a new draft to Australia/Sydney instead of UTC', () => {
    const draft = emptyDraft()
    expect(DEFAULT_OPERATOR_ZONE).toBe('Australia/Sydney')
    expect(draft.timezone).toBe('Australia/Sydney')
    expect(draft.kind).toBe('cron')
    expect(draft.timezone).not.toBe('UTC')
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
      timezone: 'Australia/Sydney',
      rule: { kind: 'manual' },
      mode: 'cron',
      createdAt: 1,
      updatedAt: 1,
      runCount: 0,
      deliveryFailures: 0,
      runs: [],
    })
    expect(row.status).toBe('paused')
    expect(row.timezone).toBe('Australia/Sydney')
    expect('nextRunAt' in row).toBe(false)
    expect('lastError' in row).toBe(false)
  })

  it('surfaces the last failed run note only while deliveryFailures is set', () => {
    expect(lastError({ deliveryFailures: 0, runs: [{ id: 'a', startedAt: 1, note: 'delivery failed' }] })).toBeUndefined()
    expect(lastError({ deliveryFailures: 2, runs: [{ id: 'a', startedAt: 1, note: 'retry 2/3' }] })).toBe('retry 2/3')
  })

  it('builds a paused create payload from the editor draft including quiet hours', () => {
    const draft = {
      ...emptyDraft(),
      title: 'ping',
      prompt: 'hello',
      kind: 'cron' as const,
      cron: '0 9 * * 1-5',
      quietEnabled: true,
      quietStart: '22:00',
      quietEnd: '07:00',
    }
    expect(draftReady(draft)).toBe(true)
    expect(draftRule(draft)).toEqual({ kind: 'cron', cron: '0 9 * * 1-5' })
    expect(draftQuietHours(draft)).toEqual({
      timeZoneIdentifier: 'Australia/Sydney',
      startMinute: 1320,
      endMinute: 420,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    })
    expect(toCreateInput(draft)).toMatchObject({
      title: 'ping',
      promptTemplate: 'hello',
      timezone: 'Australia/Sydney',
      rule: { kind: 'cron', cron: '0 9 * * 1-5' },
    })
    expect(draftReady(emptyDraft())).toBe(false)
    const next = previewNextRun(draft, Date.parse('2026-08-28T00:00:00Z'))
    expect(typeof next).toBe('number')
  })

  it('keeps an existing record timezone when opening the editor', () => {
    const draft = draftFromRoutine({
      id: 'r1',
      title: 'nightly',
      promptTemplate: 'ping',
      parameters: {},
      enabled: true,
      timezone: 'Pacific/Auckland',
      rule: { kind: 'cron', cron: '0 6 * * *' },
      quietHours: {
        timeZoneIdentifier: 'Pacific/Auckland',
        startMinute: 1320,
        endMinute: 420,
        weekdays: [2, 3, 4, 5, 6],
      },
      maxRuns: 10,
      mode: 'cron',
      createdAt: 1,
      updatedAt: 1,
      runCount: 0,
      deliveryFailures: 0,
      runs: [],
    })
    expect(draft.timezone).toBe('Pacific/Auckland')
    expect(draft.quietEnabled).toBe(true)
    expect(draft.quietStart).toBe('22:00')
    expect(draft.quietEnd).toBe('07:00')
    expect(draft.maxRuns).toBe('10')
  })
})
