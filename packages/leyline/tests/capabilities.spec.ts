import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CapabilityCache,
  FEATURE_CONTEXT_PACK,
  FEATURE_SESSION_EVENTS,
  parseCapabilities,
  STANDALONE_CAPABILITIES,
  supportsFeature,
} from '../src/capabilities.ts'

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/host_adapter_capabilities.v1.json', import.meta.url), 'utf8'),
) as { contract: number; features: Record<string, number> }

describe('capability handshake', () => {
  it('parses the pinned host-adapter fixture without version-sniffing', () => {
    const parsed = parseCapabilities(fixture)
    expect(parsed).toEqual(fixture)
    expect(supportsFeature(parsed, FEATURE_SESSION_EVENTS)).toBe(true)
    expect(supportsFeature(parsed, FEATURE_CONTEXT_PACK)).toBe(true)
    expect(supportsFeature(parsed, 'not_a_feature')).toBe(false)
  })

  it('degrades to standalone when the block is missing or empty', () => {
    expect(parseCapabilities(undefined)).toEqual(STANDALONE_CAPABILITIES)
    expect(parseCapabilities({})).toEqual(STANDALONE_CAPABILITIES)
    expect(parseCapabilities({ daemon: 'leyline 9.9.9' })).toEqual(STANDALONE_CAPABILITIES)
    expect(supportsFeature(STANDALONE_CAPABILITIES, FEATURE_SESSION_EVENTS)).toBe(false)
  })

  it('ignores non-integer and zero feature versions', () => {
    const parsed = parseCapabilities({
      contract: 1,
      features: { session_events: 0, context_pack: '1', lifecycle: 2 },
    })
    expect(parsed.features).toEqual({ lifecycle: 2 })
    expect(supportsFeature(parsed, FEATURE_SESSION_EVENTS)).toBe(false)
    expect(supportsFeature(parsed, 'lifecycle', 2)).toBe(true)
    expect(supportsFeature(parsed, 'lifecycle', 3)).toBe(false)
  })

  it('caches a probe and can degrade later', () => {
    const cache = new CapabilityCache()
    expect(cache.ready).toBe(false)
    cache.remember(fixture)
    expect(cache.ready).toBe(true)
    expect(cache.supports(FEATURE_CONTEXT_PACK)).toBe(true)
    cache.degrade()
    expect(cache.supports(FEATURE_CONTEXT_PACK)).toBe(false)
  })
})
