import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('skills package overlay', () => {
  it('inserts only lumine-skills', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch).toMatch(/id:\s*lumine-skills/)
    expect(patch).toMatch(/name:\s*'@lumine\/dsh-skills'/)
    expect(patch.match(/^- insert:/gm)).toHaveLength(1)
    expect(patch).toMatch(/Do not disable agent-loop/)
    expect(patch).not.toMatch(/id:\s*(lumine-acp-session|lumine-goal-completion|lumine-token-saver|directory-picker-browse)/)
  })

  it('root bundle mounts skills, token-saver, and leyline MCP', () => {
    const root = readFileSync(new URL('../../../cordis.patch.yml', import.meta.url), 'utf8')
    expect(root).toMatch(/id:\s*lumine-skills/)
    expect(root).toMatch(/name:\s*'@lumine\/dsh-skills'/)
    expect(root).toMatch(/id:\s*lumine-token-saver/)
    expect(root).toMatch(/name:\s*'@lumine\/dsh-token-saver'/)
    expect(root).toMatch(/id:\s*mcp-leyline/)
    expect(root).toMatch(/serverName:\s*leyline/)
    expect(root).toMatch(/leyline/)
    expect(root).toMatch(/--stdio/)
    expect(root).not.toMatch(/id:\s*llm-deepseek[\s\S]*disabled:\s*true/)
  })
})
