import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
import { resolveProviderId } from '../src/providers.ts'

const fakeChild = fileURLToPath(new URL('./fixtures/fake-acp-child.mjs', import.meta.url))

const AGENTS = [
  { preset: 'claude-code', provider: 'claude' as const, model: 'default' },
  { preset: 'codex', provider: 'codex' as const, model: 'codex' },
  { preset: 'cursor', provider: 'cursor' as const, model: 'composer-2' },
  { preset: 'grok-build', provider: 'grok' as const, model: 'grok-4.6' },
] as const

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

function createSession(preset: string) {
  const events: Array<{ type: string; data: unknown; seq: number }> = []
  let seq = 0
  return {
    id: `session-${preset}`,
    header: { cwd: process.cwd(), agentPreset: preset },
    events,
    append(type: string, data: unknown) {
      if (!isJsonSafe(data)) {
        throw new Error(`session event "${type}" carries non-JSON-serializable data`)
      }
      const event = { type, data, seq: seq++ }
      events.push(event)
      return event
    },
    requestHeader() {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index]
        if (event?.type !== 'request/header') continue
        const data = event.data as { header?: { config?: { provider: string; model: string } } }
        return data.header
      }
      return undefined
    },
  }
}

function createCtx(errors: string[], llm: ReturnType<typeof createHostLikeLlm>) {
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

function assistantText(events: Array<{ type: string; data: unknown }>): string {
  return events
    .filter(event => event.type === 'assistant/chunk')
    .map(event => (event.data as { chunk?: { type?: string; text?: string } }).chunk)
    .filter(chunk => chunk?.type === 'text-delta' && typeof chunk.text === 'string')
    .map(chunk => chunk!.text)
    .join('')
}

describe('every ACP product session', () => {
  afterEach(() => { vi.resetModules() })

  for (const agent of AGENTS) {
    it(`${agent.preset}: picker current is ${agent.provider}/${agent.model} even if host default is grok`, async () => {
      expect(resolveProviderId({
        preset: agent.preset,
        provider: 'grok',
        fallback: 'claude',
      })).toBe(agent.provider)

      const { AcpSessionAgent } = await import('../src/agent.ts')
      const { AcpCatalogRegistry, hostSelectionCurrent, lastModelSelection } = await import('../src/models.ts')
      const errors: string[] = []
      const session = createSession(agent.preset)
      const llm = createHostLikeLlm()
      const catalog = new AcpCatalogRegistry(llm)
      catalog.seedDefaults()
      const machine = new AcpSessionAgent(
        createCtx(errors, llm) as never,
        session.id as never,
        { provider: 'grok', model: 'grok-4.6' },
        session as never,
        agent.provider,
        {
          defaultProvider: 'grok',
          permission: 'yolo',
          providers: {
            [agent.provider]: {
              command: process.execPath,
              args: [fakeChild],
              env: { FAKE_ACP_PROVIDER: agent.provider },
            },
          },
        },
        catalog,
      )

      const current = hostSelectionCurrent({
        requestHeader: session.requestHeader()?.config,
        defaultSelection: { provider: 'grok', model: 'grok-4.6', reasoningEffort: 'high' },
      })
      expect(current.provider).toBe(agent.provider)
      expect(current.model).toBe(agent.model)
      expect(lastModelSelection(session.events)).toBeUndefined()
      expect(JSON.stringify(session.events.map(event => event.type))).not.toMatch(/model\/selection/)

      await machine.bindOfficialChild()
      const projected = catalog.adapter.projected(agent.provider)
      expect(projected?.provider).toBe(agent.provider)
      expect(projected?.models.some(model => model.id === agent.model)).toBe(true)
      expect(JSON.stringify(projected)).not.toMatch(/deepseek/i)
      if (agent.provider !== 'grok') {
        expect(JSON.stringify(projected)).not.toMatch(/grok-4/)
      }

      machine.followup({
        id: 'u1',
        role: 'user',
        content: [{ type: 'text', text: 'Reply with the single word pong' }],
        source: { kind: 'user' },
      } as never)
      await machine.whenIdle()
      expect(assistantText(session.events)).toMatch(/pong/i)
      expect(session.events.find(event => event.type === 'turn/start')?.data).toEqual({ turn: 1 })
      const header = session.events.find(event => event.type === 'request/header')
      expect(header?.data).toEqual({
        header: { config: { provider: agent.provider, model: agent.model } },
        reason: 'initial',
      })

      machine.followup({
        id: 'u2',
        role: 'user',
        content: [{ type: 'text', text: 'Reply with the single word ping' }],
        source: { kind: 'user' },
      } as never)
      await machine.whenIdle()
      expect(assistantText(session.events)).toMatch(/ping/i)
      expect(session.events.filter(event => event.type === 'turn/start').map(event => event.data))
        .toEqual([{ turn: 1 }, { turn: 2 }])
      expect(errors.join('\n')).not.toMatch(/non-JSON-serializable/)

      await machine.disposeChild()
    })
  }
})
