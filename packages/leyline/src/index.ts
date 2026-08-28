/**
 * Package entry. Link DSH peers from the profile `node_modules`, then load
 * the plugin. Named exports only — DSH drops `inject` on a default export.
 */
import { ensureDshPeers } from './peers.ts'

ensureDshPeers(import.meta.url)

const plugin = await import('./plugin.ts')

export const name = plugin.name
export const inject = plugin.inject
export const apply = plugin.apply
export const resolveConfig = plugin.resolveConfig
export const SOURCE_CLIENT_ID = plugin.SOURCE_CLIENT_ID
export const DEFAULT_BASE_URL = plugin.DEFAULT_BASE_URL
export const MEMORY_SOURCE_ID = plugin.MEMORY_SOURCE_ID
export const isAcpSession = plugin.isAcpSession
export const CapabilityCache = plugin.CapabilityCache
export const parseCapabilities = plugin.parseCapabilities
export const supportsFeature = plugin.supportsFeature
export const STANDALONE_CAPABILITIES = plugin.STANDALONE_CAPABILITIES
export const FEATURE_CONTEXT_PACK = plugin.FEATURE_CONTEXT_PACK
export const FEATURE_HYGIENE = plugin.FEATURE_HYGIENE
export const FEATURE_LIFECYCLE = plugin.FEATURE_LIFECYCLE
export const FEATURE_MATERIALIZE = plugin.FEATURE_MATERIALIZE
export const FEATURE_SESSION_EVENTS = plugin.FEATURE_SESSION_EVENTS
export const FEATURE_SESSION_SIMILARITY = plugin.FEATURE_SESSION_SIMILARITY
export const LeylineClient = plugin.LeylineClient
export const scrubSecrets = plugin.scrubSecrets
export const buildContextPackRequest = plugin.buildContextPackRequest
export const buildLifecycleEvent = plugin.buildLifecycleEvent
export const buildMaterializeRequest = plugin.buildMaterializeRequest
export const buildSessionEventsPayload = plugin.buildSessionEventsPayload
export const compileRecall = plugin.compileRecall
export const settleIdempotencyKey = plugin.settleIdempotencyKey
export const SESSION_EVENTS_SCHEMA = plugin.SESSION_EVENTS_SCHEMA
export const LIFECYCLE_SCHEMA = plugin.LIFECYCLE_SCHEMA
export const MATERIALIZE_SCHEMA = plugin.MATERIALIZE_SCHEMA
export const digestSession = plugin.digestSession
export const isWorthCapturing = plugin.isWorthCapturing
export const isAbsoluteGitRoot = plugin.isAbsoluteGitRoot
export const canonicalizeRepoId = plugin.canonicalizeRepoId
export const repoIdFromGitRoot = plugin.repoIdFromGitRoot
export const findGitRoot = plugin.findGitRoot
export const repoIdFromCwd = plugin.repoIdFromCwd
export const discoverLeyline = plugin.discoverLeyline
export const candidateBaseUrls = plugin.candidateBaseUrls
export const leylineHome = plugin.leylineHome
export const LeylineMemorySource = plugin.LeylineMemorySource
export const LumineLeylineHost = plugin.LumineLeylineHost
export const recallUserMessage = plugin.recallUserMessage
export const recallPrompt = plugin.recallPrompt
export const firstUserText = plugin.firstUserText
export const insertAfterFirstUser = plugin.insertAfterFirstUser
export const tagSafe = plugin.tagSafe
export const hasLeylineMcp = plugin.hasLeylineMcp
export const DSH_PEERS = plugin.DSH_PEERS
export { ensureDshPeers }

export type { Config } from './config.ts'
