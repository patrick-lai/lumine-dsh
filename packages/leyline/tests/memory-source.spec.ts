import { describe, expect, it } from 'vitest'
import { FEATURE_CONTEXT_PACK } from '../src/capabilities.ts'
import { LeylineClient } from '../src/client.ts'
import { resolveConfig } from '../src/config.ts'
import { LeylineMemorySource } from '../src/memory-source.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('LeylineMemorySource', () => {
  it('health is false and never throws when the daemon is down', async () => {
    const client = new LeylineClient({
      baseUrl: 'http://127.0.0.1:9',
      timeoutMs: 500,
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED')
      },
    })
    const source = new LeylineMemorySource({} as never, {
      client,
      resolved: resolveConfig({ spawnIfMissing: false }),
    })
    await expect(source.health()).resolves.toBe(false)
    await expect(source.recall('hello there')).resolves.toEqual([])
    await expect(source.contextPack('hello there')).resolves.toBeUndefined()
    expect(source.supports(FEATURE_CONTEXT_PACK)).toBe(false)
    expect(source.id).toBe('leyline')
  })

  it('recalls from a context-pack when the feature is present', async () => {
    const client = new LeylineClient({
      baseUrl: 'http://127.0.0.1:6868',
      timeoutMs: 500,
      fetchImpl: async (input) => {
        if (String(input).endsWith('/v1/dashboard/snapshot')) {
          return jsonResponse({
            capabilities: { contract: 1, features: { context_pack: 1 } },
          })
        }
        return jsonResponse({
          recall_id: 'recall_1',
          memories: [{ id: 'm1', title: 'Race', score: 0.9, snippet: 'isolate' }],
        })
      },
    })
    const source = new LeylineMemorySource({} as never, {
      client,
      resolved: resolveConfig({}),
    })
    await expect(source.health()).resolves.toBe(true)
    const hits = await source.recall('flaky test')
    expect(hits).toEqual([
      { memoryID: 'm1', title: 'Race', score: 0.9, excerpt: 'isolate' },
    ])
  })
})
