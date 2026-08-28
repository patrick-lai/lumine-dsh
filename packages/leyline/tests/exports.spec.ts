import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('named exports only', () => {
  it('does not default-export the plugin (DSH drops inject on default export)', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    const plugin = readFileSync(new URL('../src/plugin.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/export\s+default/)
    expect(plugin).not.toMatch(/export\s+default/)
  })
})
