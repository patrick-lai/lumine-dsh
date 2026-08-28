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
export const createCertifier = plugin.createCertifier
export const CANCEL_OPERATIONS = plugin.CANCEL_OPERATIONS
export const scanMarkers = plugin.scanMarkers
export const parseJudgeOutput = plugin.parseJudgeOutput
export const REACHED_MARKER = plugin.REACHED_MARKER
export const BLOCKED_MARKER = plugin.BLOCKED_MARKER
export const VERDICT_MARKER = plugin.VERDICT_MARKER
export const identityFence = plugin.identityFence
export const replyFingerprint = plugin.replyFingerprint
export const fakeJudge = plugin.fakeJudge
export const judgePrompt = plugin.judgePrompt
export const foldJudgeText = plugin.foldJudgeText
export const createRuntimeJudge = plugin.createRuntimeJudge
export const pinDirective = plugin.pinDirective
export const continueNudge = plugin.continueNudge
export const PLUGIN_SOURCE = plugin.PLUGIN_SOURCE
export const canMountAcpFallback = plugin.canMountAcpFallback
export const collectPluginIds = plugin.collectPluginIds
export const hasRoundDriver = plugin.hasRoundDriver
export const isLumineAcpSession = plugin.isLumineAcpSession
export const lastAssistantReply = plugin.lastAssistantReply
export const lastBoundAcpSession = plugin.lastBoundAcpSession
export const LUMINE_ACP_PRESETS = plugin.LUMINE_ACP_PRESETS
export const createAcpFallback = plugin.createAcpFallback
export const wrapUpdateGoalTool = plugin.wrapUpdateGoalTool
export const installUpdateGoalWrap = plugin.installUpdateGoalWrap
export const DSH_PEERS = plugin.DSH_PEERS
export { ensureDshPeers }

export type { Config } from './config.ts'

export default plugin.default
