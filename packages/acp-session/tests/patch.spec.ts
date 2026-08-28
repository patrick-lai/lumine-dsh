import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function patch(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

describe('ACP bundle cordis overlay', () => {
  const files = [
    patch('../../../cordis.patch.yml'),
    patch('../cordis.patch.yml'),
  ]

  it('pins browse via disable+insert and does not demand a DeepSeek key', () => {
    for (const source of files) {
      expect(source).toMatch(/id:\s*agent-loop[\s\S]*disabled:\s*true/)
      expect(source).toMatch(/id:\s*lumine-acp-session/)
      expect(source).toMatch(/name:\s*'@lumine\/dsh-acp-session'/)

      expect(source).toMatch(/id:\s*directory-picker/)
      expect(source).toMatch(/name:\s*'@deepseek-ai\/dsh-host-directory-picker-auto'/)
      expect(source).toMatch(/id:\s*directory-picker-browse/)
      expect(source).toMatch(/name:\s*'@deepseek-ai\/dsh-host-directory-picker-browse'/)
      expect(source).toMatch(/id:\s*ui-directory-picker-browse/)
      expect(source).toMatch(/name:\s*'@deepseek-ai\/dsh-client-ui-directory-picker-browse'/)
      expect(source).toMatch(/id:\s*directory-picker[\s\S]*disabled:\s*true/)

      expect(source).toMatch(/id:\s*llm-deepseek[\s\S]*disabled:\s*true/)
      expect(source).not.toMatch(/DEEPSEEK_API_KEY/)
      expect(source).not.toMatch(/\.credentials\.yaml/)
    }
  })
})
