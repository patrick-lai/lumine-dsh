import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { filePersist, openPersist } from '../src/persist.ts'
import { RoutineStore } from '../src/store.ts'
import { RoutineError } from '../src/types.ts'

describe('persist round-trip', () => {
  it('writes 0600 json, lands paused, and recomputes nextRunAt after enable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumine-routines-'))
    const path = join(dir, 'routines.json')
    const persist = filePersist(path)
    const store = new RoutineStore(persist)
    await store.load()
    const created = await store.create({
      title: 'morning triage',
      promptTemplate: 'Review the inbox for {owner}',
      parameters: { owner: 'patrick' },
      rule: { kind: 'cron', cron: '0 9 * * 1-5' },
      timezone: 'UTC',
      quietHours: { startMinute: 22 * 60, endMinute: 7 * 60, timeZoneIdentifier: 'UTC' },
      maxRuns: 20,
    }, Date.parse('2026-08-28T08:00:00Z'))

    expect(created.enabled).toBe(false)
    expect(created.nextRunAt).toBeUndefined()
    expect('nextRunAt' in created).toBe(false)
    expect(statSync(path).mode & 0o777).toBe(0o600)

    const reloaded = new RoutineStore(filePersist(path))
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
      enabled: false,
    })
    expect(again?.quietHours?.startMinute).toBe(22 * 60)
    expect(again?.nextRunAt).toBeUndefined()
    expect(again && 'nextRunAt' in again).toBe(false)

    const armed = await reloaded.enable(created.id, true, Date.parse('2026-08-28T08:00:00Z'))
    expect(armed.enabled).toBe(true)
    expect(armed.nextRunAt).toBe(Date.parse('2026-08-28T09:00:00Z'))
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
    expect(created.enabled).toBe(false)
    const again = new RoutineStore(persist)
    await again.load()
    expect(again.get(created.id)?.title).toBe('domain')
    expect(again.get(created.id)?.enabled).toBe(false)
  })

  it('falls back to a json file when storageDomain is missing', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
    const persist = await openPersist({ get() { return undefined } }, { DSH_HOME: home })
    expect(persist.kind).toBe('file')
    expect(persist.path).toContain('lumine-routines')
    expect(persist.path).toContain(home)
  })

  it('reclaims a stale activeRun on load and recomputes nextRunAt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumine-routines-'))
    const path = join(dir, 'routines.json')
    const persist = filePersist(path)
    const store = new RoutineStore(persist, 21_600_000)
    await store.load()
    const created = await store.create({
      title: 'stale',
      promptTemplate: 'ping',
      rule: { kind: 'interval', seconds: 60 },
      timezone: 'UTC',
    }, Date.parse('2026-01-01T00:00:00Z'))
    await store.enable(created.id, true, Date.parse('2026-01-01T00:00:00Z'))
    await persist.save({
      version: 1,
      routines: [{
        ...store.require(created.id),
        activeRun: { id: 'old-token', startedAt: Date.parse('2025-12-31T12:00:00Z') },
      }],
    })

    const reloaded = new RoutineStore(filePersist(path), 21_600_000)
    await reloaded.load(Date.parse('2026-01-01T01:00:00Z'))
    const recovered = reloaded.require(created.id)
    expect(recovered.activeRun).toBeUndefined()
    expect(recovered.nextRunAt).toBeDefined()
  })

  it('round-trips enable, update, delete, and overlap claim/finish', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumine-routines-'))
    const store = new RoutineStore(filePersist(join(dir, 'routines.json')))
    await store.load()
    const created = await store.create({
      title: 'interval',
      promptTemplate: 'keep going',
      rule: { kind: 'interval', seconds: 60 },
    }, Date.parse('2026-01-01T00:00:00Z'))
    expect(created.enabled).toBe(false)

    const updated = await store.update(created.id, { title: 'interval v1' }, Date.parse('2026-01-01T00:02:00Z'))
    expect(updated.title).toBe('interval v1')
    expect(updated.enabled).toBe(false)

    await store.enable(created.id, true, Date.parse('2026-01-01T00:03:00Z'))
    const claimed = await store.claimFire(created.id, new Date('2026-01-01T00:04:00Z'), { force: true })
    expect(claimed.activeRunId).toBeTruthy()
    expect(store.get(created.id)?.activeRun?.id).toBe(claimed.activeRunId)
    expect(store.get(created.id)?.runCount).toBe(0)
    await expect(store.claimFire(created.id, new Date('2026-01-01T00:04:30Z'), { staleAfterMs: 3_600_000 }))
      .rejects.toMatchObject({ code: 'ROUTINE_OVERLAP' })

    const finished = await store.finishFire(created.id, claimed.activeRunId, {
      ok: true,
      sessionId: 'sess-1',
    }, Date.parse('2026-01-01T00:04:00Z'))
    expect(finished.activeRun).toBeUndefined()
    expect(finished.runs.at(-1)?.sessionId).toBe('sess-1')
    expect(finished.runCount).toBe(1)

    const removed = await store.delete(created.id)
    expect(removed.id).toBe(created.id)
    expect(() => store.require(created.id)).toThrow(RoutineError)
  })
})
