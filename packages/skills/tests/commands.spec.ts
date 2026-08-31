import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { registerSkillCommands, SKILL_COMMANDS, skillCommandPrompt } from '../src/commands.ts'

interface RegisteredCommand {
  name: string
  handler: (invocation: Record<string, unknown>) => unknown
}

function fakeSkillsRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lumine-skill-commands-'))
  for (const name of SKILL_COMMANDS) {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), `# ${name}\n\nInstructions for ${name}.\n`)
  }
  return root
}

describe('skill slash commands', () => {
  it('registers exactly the four command-backed skills', () => {
    const registered: RegisteredCommand[] = []
    registerSkillCommands({
      commands: { register: (definition: RegisteredCommand) => registered.push(definition) },
    } as never, fakeSkillsRoot())

    expect(SKILL_COMMANDS).toEqual(['review', 'wayfinder', 'pr-warden', 'second-opinion'])
    expect(registered.map(command => command.name)).toEqual([...SKILL_COMMANDS])
  })

  it('follows up with the skill body and normalized operator input', async () => {
    const registered: RegisteredCommand[] = []
    registerSkillCommands({
      commands: { register: (definition: RegisteredCommand) => registered.push(definition) },
    } as never, fakeSkillsRoot())
    const followup = vi.fn()
    const review = registered.find(command => command.name === 'review')

    const result = await review?.handler({
      rawInput: '  inspect the current branch  ',
      agent: { followup },
    })

    expect(result).toEqual({ kind: 'success', text: 'Started /review.' })
    expect(followup).toHaveBeenCalledOnce()
    expect(followup.mock.calls[0]?.[0]).toMatchObject({
      role: 'user',
      source: { kind: 'user' },
      content: [{
        type: 'text',
        text: expect.stringContaining('Operator input: inspect the current branch'),
      }],
    })
    expect(followup.mock.calls[0]?.[0].content[0].text).toContain('Instructions for review.')
    expect(followup.mock.calls[0]?.[0].content[0].text).toContain('Workspace snapshot:')
  })

  it('labels an empty operator input explicitly', () => {
    expect(skillCommandPrompt('skill body\n', '   ')).toBe('skill body\n\nOperator input: (none)')
  })
})
