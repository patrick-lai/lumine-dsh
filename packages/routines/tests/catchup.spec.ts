import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { missedFireCount } from '../src/calendar.ts'
import { filePersist } from '../src/persist.ts'
import { RoutineStore } from '../src/store.ts'
import { snapshotJsonValue } from './snapshot-json.ts'

describe('catch-up fires exactly once', () => {
  it('claims one launch after a multi-slot gap and advances nextRun past now on finish', async () => {
    const store = new RoutineStore(filePersist(join(mkdtempSync(join(tmpdir(), 'lumine-routines-')), 'routines.json')))
    await store.load()
    const created = await store.create({
      title: 'every minute',
      promptTemplate: 'ping',
      rule: { kind: 'interval', seconds: 60 },
      timezone: 'UTC',
    }, Date.parse('2026-01-01T00:00:00Z'))
    expect(created.enabled).toBe(false)
    expect(created.nextRunAt).toBeUndefined()
    expect('nextRunAt' in created).toBe(false)

    const armed = await store.enable(created.id, true, Date.parse('2026-01-01T00:00:00Z'))
    expect(armed.nextRunAt).toBe(Date.parse('2026-01-01T00:01:00Z'))

    const now = new Date('2026-01-01T00:10:00Z')
    expect(missedFireCount({ ...armed }, now)).toBe(9)

    const first = await store.claimFire(created.id, now, { staleAfterMs: 3_600_000 })
    expect(first.missedCount).toBe(9)
    expect(first.routine.runCount).toBe(0)
    expect(first.routine.activeRun?.id).toBe(first.activeRunId)
    expect(first.routine.nextRunAt).toBe(armed.nextRunAt)

    await expect(store.claimFire(created.id, now, { staleAfterMs: 3_600_000 }))
      .rejects.toMatchObject({ code: 'ROUTINE_OVERLAP' })

    const finished = await store.finishFire(created.id, first.activeRunId, {
      ok: true,
      missedCount: first.missedCount,
      note: `missed ${first.missedCount} tick(s)`,
    }, now.getTime())
    expect(finished.runCount).toBe(1)
    expect(finished.runs.at(-1)?.note).toMatch(/missed 9/)
    expect(finished.nextRunAt).toBeGreaterThan(now.getTime())
    expect(finished.nextRunAt).toBe(Date.parse('2026-01-01T00:11:00Z'))

    await expect(store.claimFire(created.id, now, { staleAfterMs: 3_600_000 }))
      .rejects.toMatchObject({ code: 'ROUTINE_NOT_DUE' })
  })

  it('retries a failed delivery three ticks then advances so a dead target cannot wedge', async () => {
    const store = new RoutineStore(filePersist(join(mkdtempSync(join(tmpdir(), 'lumine-routines-')), 'routines.json')))
    await store.load()
    const created = await store.create({
      title: 'dead target',
      promptTemplate: 'ping',
      rule: { kind: 'interval', seconds: 60 },
      timezone: 'UTC',
    }, Date.parse('2026-01-01T00:00:00Z'))
    await store.enable(created.id, true, Date.parse('2026-01-01T00:00:00Z'))

    for (let index = 1; index <= 2; index += 1) {
      const claimed = await store.claimFire(created.id, new Date('2026-01-01T00:01:00Z'), { force: true })
      const failed = await store.finishFire(created.id, claimed.activeRunId, { ok: false, note: 'no agents' })
      expect(failed.deliveryFailures).toBe(index)
      expect(failed.lastRunAt).toBeUndefined()
      expect('activeRun' in failed).toBe(false)
      expect(snapshotJsonValue(failed)).toEqual(failed)
      expect(snapshotJsonValue({ routines: store.list() })).toEqual({ routines: store.list() })
    }

    const third = await store.claimFire(created.id, new Date('2026-01-01T00:01:00Z'), { force: true })
    const advanced = await store.finishFire(
      created.id,
      third.activeRunId,
      { ok: false, note: 'no agents' },
      Date.parse('2026-01-01T00:01:00Z'),
    )
    expect(advanced.deliveryFailures).toBe(0)
    expect(advanced.lastRunAt).toBe(Date.parse('2026-01-01T00:01:00Z'))
    expect(advanced.nextRunAt).toBe(Date.parse('2026-01-01T00:02:00Z'))
    expect(advanced.runs.at(-1)?.note).toMatch(/advanced after 3/)
    expect('activeRun' in advanced).toBe(false)
    expect(snapshotJsonValue(advanced)).toEqual(advanced)
  })
})
