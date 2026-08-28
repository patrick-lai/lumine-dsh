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
export const MissingCliError = plugin.MissingCliError
export const PRESET_TO_PROVIDER = plugin.PRESET_TO_PROVIDER
export const PROVIDER_IDS = plugin.PROVIDER_IDS
export const resolveLaunch = plugin.resolveLaunch
export const resolveProviderId = plugin.resolveProviderId
export const whichOnPath = plugin.whichOnPath
export const TurnProjector = plugin.TurnProjector
export const lastBoundAcpSession = plugin.lastBoundAcpSession
export const userMessageText = plugin.userMessageText
export const AcpCatalogAdapter = plugin.AcpCatalogAdapter
export const AcpCatalogRegistry = plugin.AcpCatalogRegistry
export const configIdForModel = plugin.configIdForModel
export const configIdForReasoning = plugin.configIdForReasoning
export const fallbackCatalog = plugin.fallbackCatalog
export const grokSeedCatalog = plugin.grokSeedCatalog
export const hostSelectionCurrent = plugin.hostSelectionCurrent
export const lastModelSelection = plugin.lastModelSelection
export const pickerSnapshot = plugin.pickerSnapshot
export const projectAcpModels = plugin.projectAcpModels
export const seedSessionRoute = plugin.seedSessionRoute
export const selectionFromCatalog = plugin.selectionFromCatalog
export const DSH_PEERS = plugin.DSH_PEERS
export { ensureDshPeers }

export type { Config, PermissionMode, ProviderOverride } from './config.ts'
export type { ProviderId, ResolvedLaunch } from './providers.ts'
export type { CatalogModel, HostModelSelection, ProjectedCatalog } from './models.ts'

export default plugin.default
