import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function patch(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

const root = patch('../../../cordis.patch.yml')
const pkg = patch('../cordis.patch.yml')
const readme = patch('../../../README.md')
const pkgReadme = patch('../README.md')

describe('lumine-chat cordis overlay', () => {
  it('inserts lumine-chat on the root bundle after the ACP factory', () => {
    expect(root).toMatch(/id:\s*lumine-chat/)
    expect(root).toMatch(/name:\s*'@lumine\/dsh-chat'/)
    const acp = root.indexOf("id: lumine-acp-session")
    const chat = root.indexOf('id: lumine-chat')
    expect(acp).toBeGreaterThan(-1)
    expect(chat).toBeGreaterThan(acp)
  })

  it('package-only overlay inserts this plugin only', () => {
    expect(pkg).toMatch(/id:\s*lumine-chat/)
    expect(pkg).toMatch(/name:\s*'@lumine\/dsh-chat'/)
    expect(pkg).not.toMatch(/id:\s*agent-loop/)
    expect(pkg).not.toMatch(/id:\s*lumine-acp-session/)
    expect(pkg).not.toMatch(/id:\s*directory-picker-browse/)
  })

  it('documents the Lumine activity strip', () => {
    expect(pkgReadme).toMatch(/activity strip/)
    expect(pkgReadme).toMatch(/inbuilt chat/)
    expect(readme).toMatch(/activity strip/)
    expect(readme).toMatch(/@lumine\/dsh-chat/)
  })
})
