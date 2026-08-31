import { ensureDshPeers } from './peers.ts'

ensureDshPeers(import.meta.url)

const plugin = await import('./plugin.ts')

export const name = plugin.name
export const inject = plugin.inject
export const apply = plugin.apply
export const TokenSaverService = plugin.TokenSaverService
export const doctrineFor = plugin.doctrineFor
export const tokenOffloadSection = plugin.tokenOffloadSection
export const routeSubagent = plugin.routeSubagent
export const load = plugin.load
export const parseLevel = plugin.parseLevel
export const save = plugin.save
export const DSH_PEERS = plugin.DSH_PEERS
export const TOKEN_SAVER_RPC_NAMESPACE = plugin.TOKEN_SAVER_RPC_NAMESPACE

export type { TokenSaverLevel, TokenSaverState } from './store.ts'
export { tokenSaverPath, resolveDshHome, DEFAULT_TOKEN_SAVER_LEVEL } from './store.ts'
export { ensureDshPeers }
export default plugin.default
