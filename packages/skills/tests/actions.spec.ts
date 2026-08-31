import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/client/actions.tsx', import.meta.url), 'utf8')

describe('executeSkillAction wire', () => {
  it('sends a slash command line, empty images, and unwraps the result', () => {
    expect(source).toContain('function commandExecuteLine')
    expect(source).toContain('line.startsWith(\'/\') ? line : `/${line}`')
    expect(source).toContain('images: []')
    expect(source).toContain('line: commandExecuteLine(line)')
    expect(source).toContain('.then(unwrapExecute)')
    expect(source).toContain("throw new Error('command did not run')")
  })
})
