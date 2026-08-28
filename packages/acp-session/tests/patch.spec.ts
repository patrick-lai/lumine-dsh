import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function patch(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

const root = patch('../../../cordis.patch.yml')
const pkg = patch('../cordis.patch.yml')

describe('ACP bundle cordis overlay', () => {
  it('replaces agent-loop with the ACP factory and does not demand a DeepSeek key', () => {
    for (const source of [root, pkg]) {
      expect(source).toMatch(/id:\s*agent-loop[\s\S]*disabled:\s*true/)
      expect(source).toMatch(/id:\s*lumine-acp-session/)
      expect(source).toMatch(/name:\s*'@lumine\/dsh-acp-session'/)
      expect(source).not.toMatch(/id:\s*llm-deepseek[\s\S]*disabled:\s*true/)
      expect(source).not.toMatch(/apiKeyEnv:\s*DEEPSEEK_API_KEY/)
      expect(source).not.toMatch(/credentials\.set/)
    }
  })

  it('pins browse once on the root bundle, not again on the package or a copied profile layer', () => {
    expect(root).toMatch(/id:\s*directory-picker/)
    expect(root).toMatch(/name:\s*'@deepseek-ai\/dsh-host-directory-picker-auto'/)
    expect(root).toMatch(/id:\s*directory-picker-browse/)
    expect(root).toMatch(/name:\s*'@deepseek-ai\/dsh-host-directory-picker-browse'/)
    expect(root).toMatch(/id:\s*ui-directory-picker-browse/)
    expect(root).toMatch(/name:\s*'@deepseek-ai\/dsh-client-ui-directory-picker-browse'/)
    expect(root).toMatch(/id:\s*directory-picker[\s\S]*disabled:\s*true/)

    expect(pkg).not.toMatch(/id:\s*directory-picker-browse/)
    expect(pkg).not.toMatch(/id:\s*ui-directory-picker-browse/)
    expect(pkg).toMatch(/must not re-insert|Do not\s+repeat that insert/i)
  })
})
