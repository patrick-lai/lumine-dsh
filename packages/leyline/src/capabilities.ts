/**
 * Host-adapter capability handshake. Probe features, never version-sniff a
 * daemon string. A missing block or missing feature means standalone (no-op).
 */

export const FEATURE_SESSION_EVENTS = 'session_events'
export const FEATURE_LIFECYCLE = 'lifecycle'
export const FEATURE_CONTEXT_PACK = 'context_pack'
export const FEATURE_MATERIALIZE = 'materialize'
export const FEATURE_HYGIENE = 'hygiene'
export const FEATURE_SESSION_SIMILARITY = 'session_similarity'

export interface LeylineCapabilities {
  contract: number
  features: Record<string, number>
}

export const STANDALONE_CAPABILITIES: LeylineCapabilities = Object.freeze({
  contract: 0,
  features: Object.freeze({}),
})

export function parseCapabilities(value: unknown): LeylineCapabilities {
  if (!value || typeof value !== 'object') return STANDALONE_CAPABILITIES
  const record = value as { contract?: unknown; features?: unknown }
  const contract = typeof record.contract === 'number' && Number.isFinite(record.contract)
    ? Math.trunc(record.contract)
    : 0
  const features: Record<string, number> = {}
  if (record.features && typeof record.features === 'object') {
    for (const [name, version] of Object.entries(record.features as Record<string, unknown>)) {
      if (typeof version === 'number' && Number.isFinite(version) && version >= 1) {
        features[name] = Math.trunc(version)
      }
    }
  }
  return { contract, features }
}

export function supportsFeature(
  capabilities: LeylineCapabilities,
  feature: string,
  atLeast = 1,
): boolean {
  return (capabilities.features[feature] ?? 0) >= atLeast
}

export class CapabilityCache {
  private capabilities: LeylineCapabilities = STANDALONE_CAPABILITIES
  private probed = false

  get snapshot(): LeylineCapabilities {
    return this.capabilities
  }

  get ready(): boolean {
    return this.probed
  }

  remember(value: unknown): LeylineCapabilities {
    this.capabilities = parseCapabilities(value)
    this.probed = true
    return this.capabilities
  }

  degrade(): LeylineCapabilities {
    this.capabilities = STANDALONE_CAPABILITIES
    this.probed = true
    return this.capabilities
  }

  supports(feature: string, atLeast = 1): boolean {
    return supportsFeature(this.capabilities, feature, atLeast)
  }
}
