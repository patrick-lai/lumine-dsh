import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('built loader entry', () => {
  it('does not value-import FiberState from @deepseek-ai/cordis', () => {
    const built = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
    expect(built).toMatch(/from ["']@deepseek-ai\/cordis["']/)
    expect(built).not.toMatch(
      /import\s*\{[^}]*\bFiberState\b[^}]*\}\s*from\s*["']@deepseek-ai\/cordis["']/,
    )
    const cordisImport = built.match(/import\s*\{([^}]*)\}\s*from\s*["']@deepseek-ai\/cordis["']/)
    expect(cordisImport?.[1]).toBeDefined()
    expect(cordisImport?.[1]).not.toMatch(/\bFiberState\b/)
    expect(cordisImport?.[1]).toMatch(/\bService\b/)
  })
})
