import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function patch(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

const root = patch('../../../cordis.patch.yml')
const pkg = patch('../cordis.patch.yml')

describe('Leyline bundle cordis overlay', () => {
  it('inserts lumine-leyline on the root bundle and the package overlay', () => {
    for (const source of [root, pkg]) {
      expect(source).toMatch(/id:\s*lumine-leyline/)
      expect(source).toMatch(/name:\s*'@lumine\/dsh-leyline'/)
      expect(source).toMatch(/materialize:\s*false/)
      expect(source).not.toMatch(/id:\s*llm-deepseek[\s\S]*disabled:\s*true/)
      expect(source).not.toMatch(/apiKeyEnv:\s*DEEPSEEK_API_KEY/)
    }
  })

  it('does not disable agent-loop or re-insert directory-picker-browse from this package', () => {
    expect(pkg).not.toMatch(/id:\s*agent-loop/)
    expect(pkg).not.toMatch(/id:\s*directory-picker-browse/)
    expect(pkg).not.toMatch(/id:\s*ui-directory-picker-browse/)
    expect(root).toMatch(/id:\s*lumine-acp-session/)
    expect(root).toMatch(/id:\s*lumine-leyline/)
  })
})
