import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { userMessageText } from '../src/deliver.ts'
import { filePersist } from '../src/persist.ts'
import { RoutineRuntime } from '../src/runtime.ts'
import { RoutineStore } from '../src/store.ts'
import { createRoutineToolHandlers, registerRoutineTools, ROUTINE_TOOL_NAMES } from '../src/tools.ts'
import { RoutineError } from '../src/types.ts'

interface SessionRecord {
  id: string
  events: Array<{ type: string; data: unknown }>
  append(type: string, data: unknown): { type: string; data: unknown }
}

function createHarness() {
  const sessions = new Map<string, SessionRecord>()
  const authoring: SessionRecord = {
    id: 'author',
    events: [],
    append(type, data) {
      this.events.push({ type, data })
      return { type, data }
    },
  }
  sessions.set('author', authoring)
  const createdAgents: Array<{ id: string; sends: unknown[] }> = []
  const agents = {
    async create(opts: { sessionId?: string }) {
      const id = opts.sessionId ?? `spawned-${createdAgents.length}`
      const events: Array<{ type: string; data: unknown }> = []
      const session: SessionRecord = {
        id,
        events,
        append(type, data) {
          events.push({ type, data })
          return { type, data }
        },
      }
      sessions.set(id, session)
      const sends: unknown[] = []
      const agent = {
        id,
        sessionId: id,
        session,
        send(message: unknown) {
          sends.push(message)
        },
      }
      createdAgents.push({ id, sends })
      return { agent, dispose: async () => {} }
    },
  }
  return {
    agents,
    sessionsApi: { get(id: string) { return sessions.get(id) } },
    sessions,
    authoring,
    createdAgents,
  }
}

describe('operator gate and fire', () => {
  it('creates paused, refuses run_now while paused, and never registers schedule_*', async () => {
    const harness = createHarness()
    const store = new RoutineStore(filePersist(join(mkdtempSync(join(tmpdir(), 'lumine-routines-')), 'routines.json')))
    await store.load()
    const runtime = new RoutineRuntime(store, {
      agents: harness.agents,
      sessions: harness.sessionsApi,
    }, () => Date.parse('2026-01-01T00:00:00Z'))

    const created = await runtime.create({
      title: 'paused',
      promptTemplate: 'Hello {{WHO}}',
      parameters: { WHO: 'Ada' },
      rule: { kind: 'interval', seconds: 1 },
      timezone: 'UTC',
    })
    expect(created.enabled).toBe(false)

    await expect(runtime.runNow(created.id)).rejects.toMatchObject({ code: 'ROUTINE_PAUSED' })
    expect(harness.createdAgents).toHaveLength(0)

    const registered: string[] = []
    const names = registerRoutineTools({
      tools: { register(tool: { name: string }) { registered.push(tool.name) } },
    }, runtime)
    expect(names).toEqual([...ROUTINE_TOOL_NAMES])
    expect(registered).toEqual([...ROUTINE_TOOL_NAMES])
    expect(registered.some(name => name.startsWith('schedule_'))).toBe(false)
    expect(registered).not.toContain('routine_enable')

    const runNow = createRoutineToolHandlers(runtime).find(tool => tool.name === 'routine_run_now')
    const refused = await runNow!.execute({ id: created.id })
    expect(refused.isError).toBe(true)
    expect(refused.content[0]?.text).toMatch(/ROUTINE_PAUSED/)
  })

  it('after operator-enable + short interval, a second session has the prompt as its first user message', async () => {
    const harness = createHarness()
    let now = Date.parse('2026-01-01T00:00:00Z')
    const store = new RoutineStore(filePersist(join(mkdtempSync(join(tmpdir(), 'lumine-routines-')), 'routines.json')))
    await store.load()
    const runtime = new RoutineRuntime(store, {
      agents: harness.agents,
      sessions: harness.sessionsApi,
    }, () => now)

    const created = await runtime.create({
      title: 'morning brief',
      promptTemplate: 'Hello {{WHO}} id={{SCHEDULE_ID}} title=${SCHEDULE_TITLE}',
      parameters: { WHO: 'Ada' },
      rule: { kind: 'interval', seconds: 1 },
      timezone: 'UTC',
    })
    expect(created.enabled).toBe(false)

    await runtime.enable(created.id, true)
    now = Date.parse('2026-01-01T00:00:01.500Z')
    await runtime.runDue()

    expect(harness.createdAgents).toHaveLength(1)
    const spawned = harness.createdAgents[0]!
    expect(spawned.id).not.toBe('author')
    expect(userMessageText(spawned.sends[0])).toContain('Hello Ada')
    expect(userMessageText(spawned.sends[0])).toContain(`id=${created.id}`)
    expect(userMessageText(spawned.sends[0])).toContain('title=morning brief')
    expect(spawned.sends).toHaveLength(1)

    const spawnedSession = harness.sessions.get(spawned.id)
    expect(spawnedSession?.events.some(event => (
      event.type === 'request/context'
      && (event.data as { routineId?: string }).routineId === created.id
    ))).toBe(true)
    expect(spawnedSession?.events.some(event => event.type.startsWith('schedule/'))).toBe(false)

    expect(harness.authoring.events).toEqual([])
    expect(harness.authoring.events.filter(event => event.type === 'schedule/change')).toEqual([])
  })

  it('create tool always reports enabled:false even if the caller asks to arm', async () => {
    const harness = createHarness()
    const store = new RoutineStore(filePersist(join(mkdtempSync(join(tmpdir(), 'lumine-routines-')), 'routines.json')))
    await store.load()
    const runtime = new RoutineRuntime(store, { agents: harness.agents }, () => Date.parse('2026-01-01T00:00:00Z'))
    const create = createRoutineToolHandlers(runtime).find(tool => tool.name === 'routine_create')
    const result = await create!.execute({
      title: 'no arm',
      promptTemplate: 'ping',
      rule: { kind: 'manual' },
      enabled: true,
    })
    expect(result.isError).toBeFalsy()
    const payload = JSON.parse(result.content[0]!.text) as { enabled: boolean; routine: { enabled: boolean } }
    expect(payload.enabled).toBe(false)
    expect(payload.routine.enabled).toBe(false)
    expect(harness.createdAgents).toHaveLength(0)
  })

  it('runNow after enable stamps request/context and does not touch the authoring session', async () => {
    const harness = createHarness()
    const store = new RoutineStore(filePersist(join(mkdtempSync(join(tmpdir(), 'lumine-routines-')), 'routines.json')))
    await store.load()
    const runtime = new RoutineRuntime(store, {
      agents: harness.agents,
      sessions: harness.sessionsApi,
    }, () => Date.parse('2026-01-01T00:00:00Z'))
    const created = await runtime.create({
      title: 'now',
      promptTemplate: 'do it now',
      rule: { kind: 'manual' },
    })
    await runtime.enable(created.id, true)
    const launched = await runtime.runNow(created.id)
    expect(launched.sessionId).toBeTruthy()
    expect(launched.sessionId).not.toBe('author')
    expect(userMessageText(harness.createdAgents[0]!.sends[0])).toBe('do it now')
    expect(harness.authoring.events).toEqual([])
  })

  it('surfaces ROUTINE_PAUSED as a typed error, not a generic throw', async () => {
    const store = new RoutineStore(filePersist(join(mkdtempSync(join(tmpdir(), 'lumine-routines-')), 'routines.json')))
    await store.load()
    const runtime = new RoutineRuntime(store, {}, () => Date.now())
    const created = await runtime.create({
      title: 'paused',
      promptTemplate: 'x',
      rule: { kind: 'manual' },
    })
    await expect(runtime.runNow(created.id)).rejects.toBeInstanceOf(RoutineError)
  })
})
