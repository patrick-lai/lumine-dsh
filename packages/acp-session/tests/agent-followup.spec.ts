import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Fresh-agent followup must append turn/start { turn: 1 }. The live miss was
 * Session.append rejecting `{ turn: NaN }` ("non-JSON-serializable data").
 */

vi.mock('@deepseek-ai/dsh-agent', () => {
  class Inbox {
    private readonly queue: unknown[] = []
    constructor(
      private readonly session: { append(type: string, data: unknown): unknown },
      private readonly notifications: { inserted(message: unknown): void },
    ) {}
    get hasPending(): boolean { return this.queue.length > 0 }
    splice(_target: string, start: number, _removed: number, inserted: unknown[]): void {
      const actualStart = Math.min(Number.isFinite(start) ? Math.max(Math.trunc(start), 0) : this.queue.length, this.queue.length)
      this.queue.push(...inserted)
      this.session.append('agent/inbox/spliced', { target: 'next-turn', start: actualStart, inserted })
      for (const message of inserted) this.notifications.inserted(message)
    }
    claim(target: string, _turn: number): unknown[] {
      const claimed = this.queue.splice(0, 1)
      if (claimed.length > 0) {
        this.session.append('agent/inbox/spliced', {
          target,
          start: 0,
          removedCount: 1,
          inserted: [],
        })
      }
      return claimed
    }
    clear(): void { this.queue.length = 0 }
  }
  return { Inbox, emitAgentEvent: () => {} }
})

vi.mock('@deepseek-ai/dsh-scope', () => ({
  createScope: (ctx: Record<string, unknown>) => ({
    ctx: { ...ctx, extend: (extra: Record<string, unknown>) => ({ ...ctx, ...extra }) },
    dispose: async () => {},
  }),
}))

import { createHostLikeLlm } from './host-llm.ts'

const fakeChild = fileURLToPath(new URL('./fixtures/fake-acp-child.mjs', import.meta.url))

function isJsonSafe(value: unknown): boolean {
  if (value === null) return true
  const kind = typeof value
  if (kind === 'boolean' || kind === 'string') return true
  if (kind === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(item => isJsonSafe(item))
  if (kind === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value).every(item => isJsonSafe(item))
  }
  return false
}

function createSession() {
  const events: Array<{ type: string; data: unknown; seq: number }> = []
  let seq = 0
  return {
    id: 'session-followup-1',
    header: { cwd: process.cwd(), agentPreset: 'grok-build' },
    events,
    append(type: string, data: unknown) {
      if (!isJsonSafe(data)) {
        throw new Error(`session event "${type}" carries non-JSON-serializable data`)
      }
      const event = { type, data, seq: seq++ }
      events.push(event)
      return event
    },
  }
}

function createCtx(errors: string[], llm: ReturnType<typeof createHostLikeLlm> | { listProviders: () => Array<{ id: string }> } = createHostLikeLlm()) {
  const ctx = {
    logger: {
      warn: () => {},
      info: () => {},
      error: (message: unknown) => { errors.push(String(message)) },
    },
    agents: { withInitiator: (_agent: unknown, operation: () => unknown) => operation() },
    on: () => () => {},
    llm,
    get(name: string) {
      if (name === 'llm') return ctx.llm
      return undefined
    },
  }
  Object.defineProperty(ctx, 'agentDefaultModel', {
    get() {
      throw new Error('cannot get property "agentDefaultModel" without inject')
    },
  })
  return ctx
}

describe('AcpSessionAgent first followup', () => {
  afterEach(() => { vi.resetModules() })

  it('rejects the live NaN turn/start payload the same way Session.append does', () => {
    const session = createSession()
    expect(() => session.append('turn/start', { turn: Number.NaN }))
      .toThrow('session event "turn/start" carries non-JSON-serializable data')
    expect(() => session.append('step/end', { turn: Number.NaN, step: Number.NaN }))
      .toThrow('session event "step/end" carries non-JSON-serializable data')
  })

  it('appends turn/start { turn: 1 } on the first followup of a fresh grok-build agent', async () => {
    const { AcpSessionAgent } = await import('../src/agent.ts')
    const { AcpCatalogRegistry, lastModelSelection } = await import('../src/models.ts')
    const errors: string[] = []
    const session = createSession()
    const llm = createHostLikeLlm()
    const catalog = new AcpCatalogRegistry(llm)
    catalog.seedDefaults()
    const agent = new AcpSessionAgent(
      createCtx(errors, llm) as never,
      'session-followup-1' as never,
      { provider: 'grok' },
      session as never,
      'grok',
      {
        defaultProvider: 'grok',
        permission: 'yolo',
        providers: {
          grok: { command: process.execPath, args: [fakeChild] },
        },
      },
      catalog,
    )

    expect(lastModelSelection(session.events)?.provider).toBe('grok')
    expect(lastModelSelection(session.events)?.model).toBe('grok-4.6')

    agent.followup({
      id: 'u1',
      role: 'user',
      content: [{ type: 'text', text: 'Reply with the single word pong' }],
      source: { kind: 'user' },
    } as never)

    await agent.whenIdle()

    const start = session.events.find(event => event.type === 'turn/start')
    expect(start, `events=${JSON.stringify(session.events.map(event => event.type))}; errors=${errors.join('\n')}`)
      .toEqual(expect.objectContaining({ type: 'turn/start', data: { turn: 1 } }))
    expect(start?.data).toEqual({ turn: 1 })
    expect(Number.isNaN((start?.data as { turn?: number }).turn)).toBe(false)
    expect(session.events.some(event => event.type === 'turn/end')).toBe(true)
    expect(errors.join('\n')).not.toMatch(/non-JSON-serializable/)

    await agent.disposeChild()
  })

  it('does not write unregistered grok into request/header so the second prompt stays admitted', async () => {
    const { AcpSessionAgent } = await import('../src/agent.ts')
    const { AcpCatalogRegistry, hostSelectionCurrent } = await import('../src/models.ts')
    const errors: string[] = []
    const session = createSession()
    const llm = createHostLikeLlm()
    const catalog = new AcpCatalogRegistry(llm)
    catalog.seedDefaults()
    const unserved = {
      listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
    }
    const agent = new AcpSessionAgent(
      createCtx(errors, unserved) as never,
      'session-followup-1' as never,
      { provider: 'grok', model: 'deepseek-v4-flash' },
      session as never,
      'grok',
      {
        defaultProvider: 'grok',
        permission: 'yolo',
        providers: {
          grok: { command: process.execPath, args: [fakeChild] },
        },
      },
      catalog,
    )

    agent.followup({
      id: 'u1',
      role: 'user',
      content: [{ type: 'text', text: 'Reply with the single word pong' }],
      source: { kind: 'user' },
    } as never)
    await agent.whenIdle()

    const headers = session.events.filter(event => event.type === 'request/header')
    expect(headers).toEqual([])
    const afterFirst = hostSelectionCurrent({
      requestHeader: undefined,
      defaultSelection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })
    expect(afterFirst.provider).toBe('deepseek-official')

    agent.followup({
      id: 'u2',
      role: 'user',
      content: [{ type: 'text', text: 'ping' }],
      source: { kind: 'user' },
    } as never)
    await agent.whenIdle()

    expect(session.events.filter(event => event.type === 'request/header')).toEqual([])
    expect(session.events.filter(event => event.type === 'turn/start').map(event => event.data))
      .toEqual([{ turn: 1 }, { turn: 2 }])
    expect(JSON.stringify(session.events.filter(event => event.type === 'request/header')))
      .not.toMatch(/"provider":"grok"/)
    expect(errors.join('\n')).not.toMatch(/non-JSON-serializable/)

    await agent.disposeChild()
  })

  it('writes grok/grok-4.6 into request/header only after the host registry serves grok', async () => {
    const { AcpSessionAgent } = await import('../src/agent.ts')
    const { AcpCatalogRegistry, hostSelectionCurrent } = await import('../src/models.ts')
    const errors: string[] = []
    const session = createSession()
    const llm = createHostLikeLlm()
    const catalog = new AcpCatalogRegistry(llm)
    catalog.seedDefaults()
    const agent = new AcpSessionAgent(
      createCtx(errors, llm) as never,
      'session-followup-1' as never,
      { provider: 'grok', model: 'deepseek-v4-flash' },
      session as never,
      'grok',
      {
        defaultProvider: 'grok',
        permission: 'yolo',
        providers: {
          grok: { command: process.execPath, args: [fakeChild] },
        },
      },
      catalog,
    )

    agent.followup({
      id: 'u1',
      role: 'user',
      content: [{ type: 'text', text: 'Reply with the single word pong' }],
      source: { kind: 'user' },
    } as never)
    await agent.whenIdle()

    const header = session.events.find(event => event.type === 'request/header')
    expect(header?.data).toEqual({
      header: { config: { provider: 'grok', model: 'grok-4.6' } },
      reason: 'initial',
    })
    expect(JSON.stringify(header)).not.toMatch(/deepseek/i)
    const current = hostSelectionCurrent({
      requestHeader: { provider: 'grok', model: 'grok-4.6' },
      defaultSelection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })
    expect(current).toEqual({ provider: 'grok', model: 'grok-4.6' })

    agent.followup({
      id: 'u2',
      role: 'user',
      content: [{ type: 'text', text: 'ping' }],
      source: { kind: 'user' },
    } as never)
    await agent.whenIdle()
    expect(session.events.filter(event => event.type === 'turn/start').map(event => event.data))
      .toEqual([{ turn: 1 }, { turn: 2 }])

    await agent.disposeChild()
  })
})
