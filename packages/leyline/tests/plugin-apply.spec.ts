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

describe('plugin apply', () => {
  it('inserts the host service and stays healthy when the daemon is down', async () => {
    const pluginConfigs: unknown[] = []
    const ctx = {
      ...hostCtx({}),
      plugin(_plugin: unknown, config: unknown) {
        pluginConfigs.push(config)
        return { ctx: this, dispose() {} }
      },
    }
    apply(ctx as never, { baseUrl: 'http://127.0.0.1:9', materialize: true })
    expect(pluginConfigs).toHaveLength(1)
    expect(pluginConfigs[0]).toMatchObject({
      baseUrl: 'http://127.0.0.1:9',
      materialize: true,
      maxMemories: 4,
      maxTokens: 1200,
    })
  })

  it('probes, packs, and settles without throwing when the daemon answers', async () => {
    const posts: Array<{ path: string; body: unknown }> = []
    const client = new LeylineClient({
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
    const listeners: Record<string, Array<(...args: unknown[]) => unknown>> = {}
    const host = new LumineLeylineHost(hostCtx(listeners) as never, {
      baseUrl: 'http://127.0.0.1:6868',
      materialize: false,
      maxMemories: 4,
      maxTokens: 1200,
      workspaceId: 'ws_local',
      timeoutMs: 1000,
      client,
    })
    const session = {
      id: 'sess-live',
      header: { version: 1, id: 'sess-live', createdAt: Date.parse('2026-08-28T09:00:00Z'), cwd: '/tmp/not-git' },
      events: [
        {
          type: 'user/message',
          seq: 0,
          time: Date.parse('2026-08-28T09:01:00Z'),
          data: { message: { content: [{ type: 'text', text: 'hello' }] } },
        },
        {
          type: 'turn/end',
          seq: 1,
          time: Date.parse('2026-08-28T09:02:00Z'),
          data: { reason: { kind: 'completed' } },
        },
      ],
      append() { throw new Error('unused') },
    }
    const agent = { id: 'sess-live', session, ctx: { get() { return undefined } } }
    await host.onSessionStart(agent as never)
    expect(client.capabilities.supports(FEATURE_CONTEXT_PACK)).toBe(true)
    await host.onSessionEnd(agent as never)
    expect(posts.some(entry => entry.path.endsWith('/v1/context-pack'))).toBe(true)
    const settle = posts.find(entry => entry.path.endsWith('/v1/session/events'))
    expect(settle).toBeDefined()
    const body = settle?.body as { source_client: { client_id: string }; events: Array<{ idempotency_key: string }> }
    expect(body.source_client.client_id).toBe('lumine-dsh')
    expect(body.events[0]?.idempotency_key).toBe('lumine-dsh-settle-sess-live')
    expect(client.capabilities.supports(FEATURE_SESSION_EVENTS)).toBe(true)
  })
})
