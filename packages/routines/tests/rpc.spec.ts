import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { filePersist } from '../src/persist.ts'
import { exportRoutineRemote } from '../src/remote.ts'
import { routineRpcHandlers } from '../src/rpc-payload.ts'
import { RoutineRuntime } from '../src/runtime.ts'
import { RoutineStore } from '../src/store.ts'
import { snapshotJsonValue } from './snapshot-json.ts'

function createHost() {
  const store = new RoutineStore(filePersist(join(mkdtempSync(join(tmpdir(), 'lumine-routines-rpc-')), 'routines.json')))
  const runtime = new RoutineRuntime(store, {
    agents: { async create() { return { agent: { id: 's', send() {} }, dispose: async () => {} } } },
    sessions: { get() { return undefined } },
  }, () => Date.parse('2026-01-01T00:00:00Z'))
  return { store, runtime }
}

describe('routine RPC payloads stay lossless JSON', () => {
  it('omits nextRunAt and activeRun when nil on list/create/enable/runNow/delete', async () => {
    const { store, runtime } = createHost()
    await store.load()
    const rpc = routineRpcHandlers({
      list: () => runtime.list(),
      create: input => runtime.create(input),
      update: (id, input) => runtime.update(id, input),
      delete: id => runtime.delete(id),
      enable: (id, enabled) => runtime.enable(id, enabled),
      runNow: async id => {
        const launched = await runtime.runNow(id)
        return { ...launched, routine: store.require(id) }
      },
      require: id => store.require(id),
    })

    const created = await rpc.create({
      title: 'nightly',
      promptTemplate: 'ping',
      rule: { kind: 'interval', seconds: 60 },
      timezone: 'UTC',
    })
    expect(created.enabled).toBe(false)
    expect('nextRunAt' in created.routine).toBe(false)
    expect('activeRun' in created.routine).toBe(false)
    expect(snapshotJsonValue(created)).toEqual(created)
    expect(snapshotJsonValue({ nextRunAt: undefined })).toBeUndefined()

    const listed = await rpc.list()
    expect(listed.routines).toHaveLength(1)
    expect('nextRunAt' in listed.routines[0]!).toBe(false)
    expect(snapshotJsonValue(listed)).toEqual(listed)

    await expect(rpc.runNow(created.routine.id)).rejects.toMatchObject({ code: 'ROUTINE_PAUSED' })

    const enabled = await rpc.enable(created.routine.id, true)
    expect(enabled.routine.enabled).toBe(true)
    expect(enabled.routine.nextRunAt).toBeDefined()
    expect(snapshotJsonValue(enabled)).toEqual(enabled)

    const ran = await rpc.runNow(created.routine.id)
    expect('sessionId' in ran ? ran.sessionId : true).toBeTruthy()
    expect(snapshotJsonValue(ran)).toEqual(ran)
    if (ran.routine) {
      expect('activeRun' in ran.routine).toBe(false)
    }

    const deleted = await rpc.delete(created.routine.id)
    expect(deleted.deleted.id).toBe(created.routine.id)
    expect(snapshotJsonValue(deleted)).toEqual(deleted)
  })

  it('registers duck-typed routine.* handlers that return the same payloads', async () => {
    const { store, runtime } = createHost()
    await store.load()
    const registered = new Map<string, (...args: unknown[]) => unknown>()
    const service = {
      list: () => runtime.list(),
      create: (input: Parameters<typeof runtime.create>[0]) => runtime.create(input),
      update: (id: string, input: Parameters<typeof runtime.update>[1]) => runtime.update(id, input),
      delete: (id: string) => runtime.delete(id),
      enable: (id: string, enabled: boolean) => runtime.enable(id, enabled),
      runNow: async (id: string) => ({ ...(await runtime.runNow(id)), routine: store.require(id) }),
      require: (id: string) => store.require(id),
    }
    const names = exportRoutineRemote({
      get(name) {
        if (name === 'rpc') return { register: (key: string, handler: (...args: unknown[]) => unknown) => { registered.set(key, handler) } }
        return undefined
      },
    }, service, { prototype: {} })
    expect(names).toEqual(expect.arrayContaining([
      'routine.list', 'routine.create', 'routine.enable', 'routine.runNow', 'routine.delete',
    ]))
    const created = await registered.get('routine.create')!({
      title: 'paused',
      promptTemplate: 'hi',
      rule: { kind: 'manual' },
    })
    expect(snapshotJsonValue(created)).toEqual(created)
    expect((created as { enabled: boolean }).enabled).toBe(false)
  })
})
