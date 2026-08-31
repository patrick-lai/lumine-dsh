import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const index = readFileSync(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
const dial = readFileSync(new URL('../src/client/dial.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/client/Dial.module.css', import.meta.url), 'utf8')

describe('token saver client mounts', () => {
  it('registers the composer dial and a quiet settings section', () => {
    expect(index).toContain("name: 'conversation.input.right'")
    expect(index).toContain("id: 'token-saver'")
    expect(index).toContain("name: 'settings.section'")
    expect(index).not.toContain('sidebar.footer.action')
    expect(index).not.toContain('staticHelp')
    expect(index).not.toContain('{t(\'close\')}')
    expect(index).not.toContain('{t(\'help\')}')
  })

  it('keeps a quiet aria-pressed dial on DSW tokens', () => {
    expect(dial).toContain('aria-pressed')
    expect(dial).toContain('aria-label="Token Saver"')
    expect(dial).toContain('generation.current')
    expect(dial).toContain("tokenSaver/set'")
    expect(dial).toContain('unwrap(result)')
    expect(dial).toContain('setLevel(previous)')
    expect(css).toContain('--dsw-alias-border-l2')
    expect(css).toContain('height: 28px')
  })
})
