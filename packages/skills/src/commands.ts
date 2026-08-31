import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { shippedSkillsRoot } from './install-skills.ts'
import { tryHostSecondOpinion, type SubagentsLike } from './second-opinion.ts'
import { collectWorkspaceSnapshot } from './snapshot.ts'

export const SKILL_COMMANDS = ['review', 'wayfinder', 'pr-warden', 'second-opinion'] as const

export type SkillCommandName = typeof SKILL_COMMANDS[number]

const COMMAND_DESCRIPTIONS: Record<SkillCommandName, string> = {
  review: 'review the current change or pull request',
  wayfinder: 'map an unfamiliar repository or change',
  'pr-warden': 'inspect and restore pull request health',
  'second-opinion': 'request an independent review of the current change',
}

const SNAPSHOT_COMMANDS = new Set<SkillCommandName>(['review', 'pr-warden', 'second-opinion'])

export function skillCommandPrompt(skillBody: string, operatorInput: string, snapshot = ''): string {
  const input = operatorInput.trim()
  const parts = [
    skillBody.trim(),
    `Operator input: ${input || '(none)'}`,
  ]
  if (snapshot) parts.push('Workspace snapshot:', snapshot)
  return parts.join('\n\n')
}

function sessionCwd(agent: CommandInvocation['agent']): string | undefined {
  const cwd = (agent as { session?: { header?: { cwd?: unknown } } }).session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

export async function executeSkillCommand(
  name: SkillCommandName,
  skillBody: string,
  invocation: CommandInvocation,
  subagents?: SubagentsLike,
): Promise<CommandResult> {
  const snapshot = SNAPSHOT_COMMANDS.has(name) ? collectWorkspaceSnapshot(sessionCwd(invocation.agent)) : ''
  const prompt = skillCommandPrompt(skillBody, invocation.rawInput, snapshot)
  invocation.agent.followup(createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'user' },
  }))

  if (name === 'second-opinion') {
    const verdict = await tryHostSecondOpinion(subagents, prompt, invocation.agent, invocation.signal)
    if (verdict) {
      invocation.agent.followup(createUserMessage({
        content: [{ type: 'text', text: verdict }],
        source: { kind: 'user' },
      }))
      return { kind: 'success', text: verdict.split('\n')[0] ?? verdict }
    }
  }

  return {
    kind: 'success',
    text: `Started /${name}.`,
  }
}

/** Register one slash-command launcher for each command-backed bundled skill. */
export function registerSkillCommands(ctx: Context, skillsRoot = shippedSkillsRoot()): void {
  for (const name of SKILL_COMMANDS) {
    const skillBody = readFileSync(join(skillsRoot, name, 'SKILL.md'), 'utf8')
    ctx.commands.register({
      name,
      description: COMMAND_DESCRIPTIONS[name],
      input: { hint: '[request]' },
      handler: invocation => {
        let subagents: SubagentsLike | undefined
        try {
          subagents = (ctx as { get?: (id: string) => SubagentsLike }).get?.('subagents')
        } catch {
          subagents = undefined
        }
        return executeSkillCommand(name, skillBody, invocation, subagents)
      },
    })
  }
}
