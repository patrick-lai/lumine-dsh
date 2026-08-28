import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { filePersist, openPersist } from '../src/persist.ts'
import { RoutineStore } from '../src/store.ts'
import { RoutineError } from '../src/types.ts'

describe('persist round-trip', () => {
  it('writes a json file under a DSH_HOME-shaped path and reloads it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumine-routines-'))
    const persist = filePersist(join(dir, 'routines.json'))
    const store = new RoutineStore(persist)
    await store.load()
    const created = await store.create({
      title: 'morning triage',
      promptTemplate: 'Review the inbox for {owner}',
      parameters: { owner: 'patrick' },
      rule: { kind: 'cron', cron: '0 9 * * 1-5' },
      timezone: 'UTC',
      mode: 'cron',
      quietHours: { startMinute: 22 * 60, endMinute: 7 * 60, timeZoneIdentifier: 'UTC' },
      maxRuns: 20,
    }, Date.parse('2026-08-28T08:00:00Z'))

    const reloaded = new RoutineStore(filePersist(join(dir, 'routines.json')))
    await reloaded.load()
    const again = reloaded.get(created.id)
    expect(again).toMatchObject({
      id: created.id,
      title: 'morning triage',
      promptTemplate: 'Review the inbox for {owner}',
      parameters: { owner: 'patrick' },
      rule: { kind: 'cron', cron: '0 9 * * 1-5' },
      timezone: 'UTC',
      mode: 'cron',
      maxRuns: 20,
      enabled: true,
    })
    expect(again?.quietHours?.startMinute).toBe(22 * 60)
    expect(again?.nextRunAt).toBe(created.nextRunAt)
    expect(again?.nextRunAt).toBe(Date.parse('2026-08-28T09:00:00Z'))
  })

  it('uses a fake storageDomain when ctx.storageDomain.open exists', async () => {
    const memory = new Map<string, unknown>()
    const ctx = {
      get(name: string) {
        if (name !== 'storageDomain') return undefined
        return {
          async open() {
            return {
              table() {
                return {
                  get(id: string) { return memory.get(id) },
                  async put(id: string, value: unknown) { memory.set(id, value) },
                }
              },
              async close() {},
            }
          },
        }
      },
    }
    const persist = await openPersist(ctx)
    expect(persist.kind).toBe('storageDomain')
    const store = new RoutineStore(persist)
    await store.load()
    const created = await store.create({
      title: 'domain',
      promptTemplate: 'ping',
      rule: { kind: 'manual' },
    })
    const again = new RoutineStore(persist)
    await again.load()
    expect(again.get(created.id)?.title).toBe('domain')
  })

  it('falls back to a json file when storageDomain is missing', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
    const persist = await openPersist({ get() { return undefined } }, { DSH_HOME: home })
    expect(persist.kind).toBe('file')
    expect(persist.path).toContain('lumine-routines')
    expect(persist.path).toContain(home)
  })

  it('round-trips enable, update, delete, and overlap claim/finish', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumine-routines-'))
    const store = new RoutineStore(filePersist(join(dir, 'routines.json')))
    await store.load()
    const created = await store.create({
      title: 'grind',
      promptTemplate: 'keep going',
      rule: { kind: 'interval', seconds: 60 },
      mode: 'grind',
    }, Date.parse('2026-01-01T00:00:00Z'))

    const disabled = await store.enable(created.id, false, Date.parse('2026-01-01T00:01:00Z'))
    expect(disabled.enabled).toBe(false)
    expect(disabled.nextRunAt).toBeUndefined()

    const updated = await store.update(created.id, { title: 'grind v1' }, Date.parse('2026-01-01T00:02:00Z'))
    expect(updated.title).toBe('grind v1')

    await store.enable(created.id, true, Date.parse('2026-01-01T00:03:00Z'))
    const claimed = await store.claimFire(created.id, new Date('2026-01-01T00:04:00Z'), { staleAfterMs: 3_600_000 })
    expect(claimed.activeRunId).toBeTruthy()
    expect(store.get(created.id)?.activeRun?.id).toBe(claimed.activeRunId)
    await expect(store.claimFire(created.id, new Date('2026-01-01T00:04:30Z'), { staleAfterMs: 3_600_000 }))
      .rejects.toMatchObject({ code: 'ROUTINE_OVERLAP' })

    const finished = await store.finishFire(created.id, claimed.activeRunId, { sessionId: 'sess-1' })
    expect(finished.activeRun).toBeUndefined()
    expect(finished.runs.at(-1)?.sessionId).toBe('sess-1')
    expect(finished.runCount).toBe(1)

    const removed = await store.delete(created.id)
    expect(removed.id).toBe(created.id)
    expect(() => store.require(created.id)).toThrow(RoutineError)
  })
})
