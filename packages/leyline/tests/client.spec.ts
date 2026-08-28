import { describe, expect, it } from 'vitest'
import { FEATURE_SESSION_EVENTS } from '../src/capabilities.ts'
import { LeylineClient } from '../src/client.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Leyline HTTP client', () => {
  it('probes capabilities and caches features', async () => {
    const calls: string[] = []
    const client = new LeylineClient({
      baseUrl: 'http://127.0.0.1:6868',
      timeoutMs: 1000,
      fetchImpl: async (input) => {
        calls.push(String(input))
        return jsonResponse({
          capabilities: {
            contract: 1,
            features: { session_events: 1, context_pack: 1 },
          },
        })
      },
    })
    const first = await client.probe()
    const second = await client.probe()
    expect(first.features.session_events).toBe(1)
    expect(second).toEqual(first)
    expect(client.capabilities.supports(FEATURE_SESSION_EVENTS)).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toBe('http://127.0.0.1:6868/v1/dashboard/snapshot')
  })

  it('degrades to a silent no-op when the daemon is down', async () => {
    const client = new LeylineClient({
      baseUrl: 'http://127.0.0.1:6868',
      timeoutMs: 1000,
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED')
      },
    })
    const caps = await client.probe()
    expect(caps.features).toEqual({})
    expect(client.capabilities.supports(FEATURE_SESSION_EVENTS)).toBe(false)
    const posted = await client.post('/v1/session/events', { nope: true })
    expect(posted).toBeUndefined()
  })

  it('treats a non-2xx snapshot as standalone', async () => {
    const client = new LeylineClient({
      baseUrl: 'http://127.0.0.1:9',
      timeoutMs: 1000,
      fetchImpl: async () => jsonResponse({ error: 'no' }, 503),
    })
    await client.probe()
    expect(client.capabilities.snapshot.contract).toBe(0)
  })
})
