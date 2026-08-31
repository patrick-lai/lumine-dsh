/**
 * Package entry. Link DSH peers from the profile `node_modules`, then load
 * the plugin. A static plugin export would resolve DSH imports too early.
 */
import { ensureDshPeers } from './peers.ts'

ensureDshPeers(import.meta.url)

const plugin = await import('./plugin.ts')

export const name = plugin.name
export const inject = plugin.inject
export const apply = plugin.apply
export const SKILL_COMMANDS = plugin.SKILL_COMMANDS
export const BUNDLED_SKILLS = plugin.BUNDLED_SKILLS
export const installSkills = plugin.installSkills
export const resolveDshHome = plugin.resolveDshHome
export const shippedSkillsRoot = plugin.shippedSkillsRoot
export const registerSkillCommands = plugin.registerSkillCommands
export const skillCommandPrompt = plugin.skillCommandPrompt
export const executeSkillCommand = plugin.executeSkillCommand
export const collectWorkspaceSnapshot = plugin.collectWorkspaceSnapshot
export const tryHostSecondOpinion = plugin.tryHostSecondOpinion
export { ensureDshPeers, DSH_PEERS } from './peers.ts'

export default plugin.default
