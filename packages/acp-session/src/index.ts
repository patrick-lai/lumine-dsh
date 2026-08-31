/**
 * Package entry. Link DSH peers from the profile `node_modules`, then load
 * the plugin. Static `export * from './plugin'` would hoist `@deepseek-ai/cordis`
 * before the symlink exists.
 */
import { ensureDshPeers } from './peers.ts'

ensureDshPeers(import.meta.url)

const plugin = await import('./plugin.ts')

export const name = plugin.name
export const inject = plugin.inject
export const apply = plugin.apply
export const resolveConfig = plugin.resolveConfig
export const resolveWorktrees = plugin.resolveWorktrees
export const lastBoundWorktree = plugin.lastBoundWorktree
export const acquireWorktree = plugin.acquireWorktree
export const releaseWorktree = plugin.releaseWorktree
export const classifyReclaim = plugin.classifyReclaim
export const isClaimable = plugin.isClaimable
export const repoName = plugin.repoName
export const slug = plugin.slug
export const sha6 = plugin.sha6
export const poolRoot = plugin.poolRoot
export const isPooledWorktreePath = plugin.isPooledWorktreePath
export const MissingCliError = plugin.MissingCliError
export const PRESET_TO_PROVIDER = plugin.PRESET_TO_PROVIDER
export const PROVIDER_IDS = plugin.PROVIDER_IDS
export const lastSelectedAgentPreset = plugin.lastSelectedAgentPreset
export const providerFromSession = plugin.providerFromSession
export const resolveLaunch = plugin.resolveLaunch
export const resolveProviderId = plugin.resolveProviderId
export const whichOnPath = plugin.whichOnPath
export const TurnProjector = plugin.TurnProjector
export const lastBoundAcpSession = plugin.lastBoundAcpSession
export const userMessageText = plugin.userMessageText
export const AcpCatalogAdapter = plugin.AcpCatalogAdapter
export const AcpCatalogRegistry = plugin.AcpCatalogRegistry
export const catalogRoute = plugin.catalogRoute
export const configIdForModel = plugin.configIdForModel
export const configIdForReasoning = plugin.configIdForReasoning
export const constrainSessionCatalog = plugin.constrainSessionCatalog
export const fallbackCatalog = plugin.fallbackCatalog
export const grokSeedCatalog = plugin.grokSeedCatalog
export const claudeSeedCatalog = plugin.claudeSeedCatalog
export const cursorSeedCatalog = plugin.cursorSeedCatalog
export const adoptPickerCurrent = plugin.adoptPickerCurrent
export const hostSelectionCurrent = plugin.hostSelectionCurrent
export const hostServesProvider = plugin.hostServesProvider
export const hostSessionModels = plugin.hostSessionModels
export const lastModelSelection = plugin.lastModelSelection
export const mountAcpCatalog = plugin.mountAcpCatalog
export const pickerSnapshot = plugin.pickerSnapshot
export const projectAcpModels = plugin.projectAcpModels
export const seedSessionRoute = plugin.seedSessionRoute
export const selectionForAgent = plugin.selectionForAgent
export const selectionFromCatalog = plugin.selectionFromCatalog
export const selectionSupportedByAgent = plugin.selectionSupportedByAgent
export const gateApiProxySessions = plugin.gateApiProxySessions
export const installSessionPickerGate = plugin.installSessionPickerGate
export const providerOfPickerSession = plugin.providerOfPickerSession
export const LastModelsStore = plugin.LastModelsStore
export const createLastModelsStore = plugin.createLastModelsStore
export const lastModelsPath = plugin.lastModelsPath
export const parseLastModels = plugin.parseLastModels
export const DSH_PEERS = plugin.DSH_PEERS
export const describeError = plugin.describeError
export const driverErrorRecord = plugin.driverErrorRecord
export const formatDriverFailure = plugin.formatDriverFailure
export const isJsonSafe = plugin.isJsonSafe
export const nextTurnOf = plugin.nextTurnOf
export const openTurnThenClaim = plugin.openTurnThenClaim
export { ensureDshPeers }
export const leylineMcpServers = plugin.leylineMcpServers
export const LEYLINE_MCP_NAME = plugin.LEYLINE_MCP_NAME
export const listWorktrees = plugin.listWorktrees
export const boundWorktree = plugin.boundWorktree
export const leylineStatus = plugin.leylineStatus
export const WorktreeChromeService = plugin.WorktreeChromeService
export const LeylineChromeService = plugin.LeylineChromeService

export type { Config, PermissionMode, ProviderOverride, WorktreeConfig, WorktreeMode } from './config.ts'
export type { ProviderId, ResolvedLaunch } from './providers.ts'
export type { CatalogModel, HostModelSelection, ProjectedCatalog } from './models.ts'

export default plugin.default
