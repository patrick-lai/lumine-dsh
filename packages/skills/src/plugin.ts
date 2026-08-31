import type { Context } from '@deepseek-ai/cordis'
import { registerSkillCommands } from './commands.ts'
import { installSkills } from './install-skills.ts'

export const name = 'lumine-skills'
export const inject = ['commands']

export function apply(ctx: Context): void {
  installSkills()
  registerSkillCommands(ctx)
}

export { registerSkillCommands, SKILL_COMMANDS, skillCommandPrompt, executeSkillCommand } from './commands.ts'
export { collectWorkspaceSnapshot } from './snapshot.ts'
export { tryHostSecondOpinion, formatSecondOpinionResult, secondOpinionPrompt } from './second-opinion.ts'
export {
  BUNDLED_SKILLS,
  installSkills,
  resolveDshHome,
  shippedSkillsRoot,
} from './install-skills.ts'

export default {
  name,
  inject,
  apply,
}
