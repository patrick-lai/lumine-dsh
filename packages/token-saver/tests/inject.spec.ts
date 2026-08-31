import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const plugin = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8')

describe('token saver plugin contract', () => {
  it('requires native systemPrompt and uses the expected id', () => {
    expect(plugin).toMatch(/export const name = 'lumine-token-saver'/)
    expect(plugin).toMatch(/export const inject = \['systemPrompt', 'commands'\]/)
    expect(plugin).toMatch(/order:\s*TOKEN_SAVER_PROMPT_ORDER/)
    expect(plugin).toMatch(/text:\s*doctrineFor/)
  })
})
