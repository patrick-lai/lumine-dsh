import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('token saver package overlay', () => {
  it('inserts only lumine-token-saver', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch).toMatch(/id:\s*lumine-token-saver/)
    expect(patch).toMatch(/name:\s*'@lumine\/dsh-token-saver'/)
    expect(patch).not.toMatch(/disabled:/)
    expect(patch).toMatch(/Do not disable agent-loop/)
    expect(patch).not.toMatch(/id:\s*(agent-loop|directory-picker-browse|llm-deepseek)/)
    expect(patch.match(/^- insert:/gm)).toHaveLength(1)
  })
})
