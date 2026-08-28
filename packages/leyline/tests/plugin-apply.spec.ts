import { describe, expect, it } from 'vitest'
import { FEATURE_CONTEXT_PACK, FEATURE_SESSION_EVENTS } from '../src/capabilities.ts'
import { LeylineClient } from '../src/client.ts'
import { apply, LumineLeylineHost } from '../src/plugin.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function hostCtx(listeners: Record<string, Array<(...args: unknown[]) => unknown>>) {
  return {
    logger: { warn() {}, error() {}, info() {} },
    agents: { get() { return undefined }, list() { return [] } },
    sessions: { get() { return undefined } },
    get() { return undefined },
    plugin() { return { ctx: this, dispose() {} } },
    effect(fn: () => (() => unknown) | void) {
      return fn() ?? (() => {})
    },
    on(event: string, listener: (...args: unknown[]) => unknown) {
      (listeners[event] ??= []).push(listener)
      return () => {}
    },
  }
}

function liveClient(posts: Array<{ path: string; body: unknown }>): LeylineClient {
  return new LeylineClient({
    baseUrl: 'http://127.0.0.1:6868',
    timeoutMs: 1000,
    fetchImpl: async (input, init) => {
      const url = String(input)
      if (url.endsWith('/v1/dashboard/snapshot')) {
        return jsonResponse({
          capabilities: { contract: 1, features: { session_events: 1, context_pack: 1, lifecycle: 1 } },
        })
      }
      posts.push({ path: url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/v1/context-pack')) {
        return jsonResponse({ recall_id: 'recall_1', memories: [{ id: 'm1', title: 't', snippet: 's' }] })
      }
      return jsonResponse({ ok: true })
    },
  })
}

function session(id: string, extras: {
  preset?: string
  events?: Array<{ type: string; data: unknown; time?: number }>
} = {}) {
  const events = extras.events ?? [
    {
      type: 'user/message',
      data: { message: { content: [{ type: 'text', text: 'hello there' }] } },
    },
    {
      type: 'assistant/message',
      data: { text: 'ok' },
    },
    {
      type: 'turn/end',
      data: { reason: { kind: 'completed' } },
    },
  ]
  return {
    id,
    header: {
      version: 1,
      id,
      createdAt: Date.parse('2026-08-28T09:00:00Z'),
      cwd: '/tmp/not-git',
      agentPreset: extras.preset,
    },
    events: events.map((event, seq) => ({
      type: event.type,
      seq,
      time: event.time ?? Date.parse('2026-08-28T09:02:00Z'),
      data: event.data,
    })),
    append() { throw new Error('unused') },
  }
}

function agentFor(sessionObj: ReturnType<typeof session>) {
  return { id: sessionObj.id, session: sessionObj, ctx: { get() { return undefined } } }
}

const userMessages = [
  { role: 'user', content: [{ type: 'text', text: 'hello there' }] },
]

describe('plugin apply', () => {
  it('inserts the host service with tightened defaults', () => {
    const pluginConfigs: unknown[] = []
    const ctx = {
      ...hostCtx({}),
      plugin(_plugin: unknown, config: unknown) {
        pluginConfigs.push(config)
        return { ctx: this, dispose() {} }
      },
    }
    apply(ctx as never, { materialize: true, spawnIfMissing: false })
    expect(pluginConfigs).toHaveLength(1)
    expect(pluginConfigs[0]).toMatchObject({
      materialize: true,
      maxMemories: 4,
      maxTokens: 1200,
      autoRecall: true,
      sessionEventCapture: true,
      spawnIfMissing: false,
      clientId: 'lumine-dsh',
      workspaceId: 'ws_local',
    })
  })

  it('publishes ctx.memorySource (id: leyline)', () => {
    const ctx = hostCtx({})
    const posts: Array<{ path: string; body: unknown }> = []
    const host = new LumineLeylineHost(ctx as never, {
      baseUrl: 'http://127.0.0.1:6868',
      materialize: false,
      maxMemories: 4,
      maxTokens: 1200,
      workspaceId: 'ws_local',
      timeoutMs: 1000,
      autoRecall: true,
      sessionEventCapture: true,
      spawnIfMissing: false,
      clientId: 'lumine-dsh',
      client: liveClient(posts),
    })
    expect(ctx.memorySource).toBe(host.memorySource)
    expect(host.memorySource?.id).toBe('leyline')
  })

  it('injects a sourced recall on agent/pre-step and settles with lumine-dsh', async () => {
    const posts: Array<{ path: string; body: unknown }> = []
    const client = liveClient(posts)
    const host = new LumineLeylineHost(hostCtx({}) as never, {
      baseUrl: 'http://127.0.0.1:6868',
      materialize: false,
      maxMemories: 4,
      maxTokens: 1200,
      workspaceId: 'ws_local',
      timeoutMs: 1000,
      autoRecall: true,
      sessionEventCapture: true,
      spawnIfMissing: false,
      clientId: 'lumine-dsh',
      client,
    })
    const agent = agentFor(session('sess-live'))
    const next = async () => ({ kind: 'continue', messages: userMessages, agent })
    const decision = await host.onPreStep({ agent, messages: userMessages }, next) as {
      messages: Array<{ role: string; source?: { kind: string; untrusted?: boolean } }>
    }
    expect(client.capabilities.supports(FEATURE_CONTEXT_PACK)).toBe(true)
    expect(posts.some(entry => entry.path.endsWith('/v1/context-pack'))).toBe(true)
    const extra = decision.messages.at(-1)
    expect(extra?.role).toBe('user')
    expect(extra?.source?.kind).toBe('leyline-recall')
    expect(extra?.source?.untrusted).toBe(true)

    await host.onSessionEnd(agent as never)
    const settle = posts.find(entry => entry.path.endsWith('/v1/session/events'))
    expect(settle).toBeDefined()
    const body = settle?.body as {
      source_client: { client_id: string }
      events: Array<{ idempotency_key: string }>
      extensions: { 'lumine-dsh': { receipt: { result: string } } }
    }
    expect(body.source_client.client_id).toBe('lumine-dsh')
    expect(body.source_client.client_id).not.toBe('raphael')
    expect(body.events[0]?.idempotency_key).toBe('lumine-dsh-settle-sess-live')
    expect(body.extensions['lumine-dsh'].receipt.result).toBe('success')
    expect(client.capabilities.supports(FEATURE_SESSION_EVENTS)).toBe(true)
  })

  it('skips pre-step injection for ACP children', async () => {
    const posts: Array<{ path: string; body: unknown }> = []
    const host = new LumineLeylineHost(hostCtx({}) as never, {
      baseUrl: 'http://127.0.0.1:6868',
      materialize: false,
      maxMemories: 4,
      maxTokens: 1200,
      workspaceId: 'ws_local',
      timeoutMs: 1000,
      autoRecall: true,
      sessionEventCapture: true,
      spawnIfMissing: false,
      clientId: 'lumine-dsh',
      client: liveClient(posts),
    })
    const agent = agentFor(session('sess-acp', { preset: 'claude-code' }))
    const incoming = { kind: 'continue', messages: userMessages, agent }
    const decision = await host.onPreStep({ agent, messages: userMessages }, async () => incoming)
    expect(decision).toBe(incoming)
    expect(posts.some(entry => entry.path.endsWith('/v1/context-pack'))).toBe(false)
  })

  it('skips empty settlements', async () => {
    const posts: Array<{ path: string; body: unknown }> = []
    const host = new LumineLeylineHost(hostCtx({}) as never, {
      baseUrl: 'http://127.0.0.1:6868',
      materialize: false,
      maxMemories: 4,
      maxTokens: 1200,
      workspaceId: 'ws_local',
      timeoutMs: 1000,
      autoRecall: true,
      sessionEventCapture: true,
      spawnIfMissing: false,
      clientId: 'lumine-dsh',
      client: liveClient(posts),
    })
    const agent = agentFor(session('sess-empty', {
      events: [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }],
    }))
    await host.onSessionEnd(agent as never)
    expect(posts.some(entry => entry.path.endsWith('/v1/session/events'))).toBe(false)
  })

  it('never throws a health miss into the turn', async () => {
    const client = new LeylineClient({
      baseUrl: 'http://127.0.0.1:9',
      timeoutMs: 1000,
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED')
      },
    })
    const host = new LumineLeylineHost(hostCtx({}) as never, {
      baseUrl: 'http://127.0.0.1:9',
      materialize: false,
      maxMemories: 4,
      maxTokens: 1200,
      workspaceId: 'ws_local',
      timeoutMs: 1000,
      autoRecall: true,
      sessionEventCapture: true,
      spawnIfMissing: false,
      clientId: 'lumine-dsh',
      client,
    })
    const agent = agentFor(session('sess-down'))
    const incoming = { kind: 'continue', messages: userMessages, agent }
    await expect(host.onPreStep({ agent, messages: userMessages }, async () => incoming)).resolves.toBe(incoming)
    await expect(host.memorySource!.health()).resolves.toBe(false)
    await expect(host.onSessionEnd(agent as never)).resolves.toBeUndefined()
  })
})
