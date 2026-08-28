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
export const RoutineService = plugin.RoutineService
export const RoutineStore = plugin.RoutineStore
export const RoutineRuntime = plugin.RoutineRuntime
export const filePersist = plugin.filePersist
export const openPersist = plugin.openPersist
export const cronNext = plugin.cronNext
export const isActiveRunBlocking = plugin.isActiveRunBlocking
export const missedFireCount = plugin.missedFireCount
export const nextRun = plugin.nextRun
export const parseCron = plugin.parseCron
export const shouldFire = plugin.shouldFire
export const windowContains = plugin.windowContains
export const ROUTINE_TOOL_NAMES = plugin.ROUTINE_TOOL_NAMES
export const registerRoutineTools = plugin.registerRoutineTools
export const DSH_PEERS = plugin.DSH_PEERS
export const RoutineError = plugin.RoutineError
export { ensureDshPeers }

export type { Config } from './config.ts'
export type { CreateRoutineInput, Routine, RoutineRule, UpdateRoutineInput } from './types.ts'

export default plugin.default
