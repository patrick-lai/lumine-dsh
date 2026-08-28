import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { missedFireCount } from '../src/calendar.ts'
import { filePersist } from '../src/persist.ts'
import { RoutineStore } from '../src/store.ts'

describe('catch-up fires exactly once', () => {
  it('claims one launch after a multi-slot gap and advances nextRun past now', async () => {
    const store = new RoutineStore(filePersist(join(mkdtempSync(join(tmpdir(), 'lumine-routines-')), 'routines.json')))
    await store.load()
    const created = await store.create({
      title: 'every minute',
      promptTemplate: 'ping',
      rule: { kind: 'interval', seconds: 60 },
      timezone: 'UTC',
    }, Date.parse('2026-01-01T00:00:00Z'))

    const now = new Date('2026-01-01T00:10:00Z')
    expect(created.nextRunAt).toBe(Date.parse('2026-01-01T00:01:00Z'))
    expect(missedFireCount({ ...created }, now)).toBe(9)

    const first = await store.claimFire(created.id, now, { staleAfterMs: 3_600_000 })
    expect(first.missedCount).toBe(9)
    expect(first.routine.runs).toHaveLength(1)
    expect(first.routine.runs[0]?.note).toMatch(/catch-up-once/)
    expect(first.routine.runCount).toBe(1)
    expect(first.routine.nextRunAt).toBeGreaterThan(now.getTime())
    expect(first.routine.nextRunAt).toBe(Date.parse('2026-01-01T00:11:00Z'))

    await expect(store.claimFire(created.id, now, { staleAfterMs: 3_600_000 }))
      .rejects.toMatchObject({ code: 'ROUTINE_OVERLAP' })

    await store.finishFire(created.id, first.activeRunId)
    await expect(store.claimFire(created.id, now, { staleAfterMs: 3_600_000 }))
      .rejects.toMatchObject({ code: 'ROUTINE_NOT_DUE' })
  })
})
