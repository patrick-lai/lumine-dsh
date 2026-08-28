import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function patch(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

const root = patch('../../../cordis.patch.yml')
const pkg = patch('../cordis.patch.yml')

describe('goal-completion cordis overlay', () => {
  it('inserts lumine-goal-completion from the root bundle', () => {
    expect(root).toMatch(/id:\s*lumine-goal-completion/)
    expect(root).toMatch(/name:\s*'@lumine\/dsh-goal-completion'/)
    expect(root).toMatch(/timeoutMs:\s*900000/)
    expect(root).toMatch(/failClosed:\s*true/)
    expect(root).toMatch(/id:\s*lumine-acp-session/)
    expect(root).not.toMatch(/DEEPSEEK_API_KEY/)
  })

  it('keeps a one-by-one package overlay that does not re-insert ACP browse', () => {
    expect(pkg).toMatch(/id:\s*lumine-goal-completion/)
    expect(pkg).toMatch(/name:\s*'@lumine\/dsh-goal-completion'/)
    expect(pkg).not.toMatch(/id:\s*directory-picker-browse/)
    expect(pkg).not.toMatch(/id:\s*lumine-acp-session/)
  })

  it('disables the host-plane goal-round-driver in the root dump-config overlay', () => {
    expect(root).toMatch(/id:\s*goal-round-driver[\s\n]+(?:name:[^\n]+\n)?[ ]*disabled:\s*true/)
    expect(pkg).not.toMatch(/id:\s*goal-round-driver/)
  })

  it('disables goal-round-driver on every lumine ACP preset', () => {
    for (const id of ['grok-build', 'claude-code', 'codex', 'cursor']) {
      const source = patch(`../../acp-session/presets/${id}/agent.cordis.yml`)
      expect(source).toMatch(/id:\s*goal-round-driver/)
      expect(source).toMatch(/disabled:\s*true/)
    }
  })
})
