import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('built loader entry', () => {
  it('links DSH peers before dynamically importing the plugin', () => {
    const entry = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
    expect(entry).toMatch(/ensureDshPeers/)
    expect(entry).toMatch(/import\(['"]\.\/plugin\.js['"]\)/)
    expect(entry).not.toMatch(
      /import\s*\{[^}]*\bService\b[^}]*\}\s*from\s*["']@deepseek-ai\/cordis["']/,
    )
  })

  it('does not value-import FiberState from @deepseek-ai/cordis', () => {
    const built = readFileSync(new URL('../lib/plugin.js', import.meta.url), 'utf8')
    expect(built).toMatch(/from ["']@deepseek-ai\/cordis["']/)
    expect(built).not.toMatch(
      /import\s*\{[^}]*\bFiberState\b[^}]*\}\s*from\s*["']@deepseek-ai\/cordis["']/,
    )
    const cordisImport = built.match(/import\s*\{([^}]*)\}\s*from\s*["']@deepseek-ai\/cordis["']/)
    expect(cordisImport?.[1]).toBeDefined()
    expect(cordisImport?.[1]).not.toMatch(/\bFiberState\b/)
    expect(cordisImport?.[1]).toMatch(/\bService\b/)
  })

  it('does not value-import LlmAdapter; generation stays on the ACP child', () => {
    const built = readFileSync(new URL('../lib/plugin.js', import.meta.url), 'utf8')
    expect(built).not.toMatch(
      /import\s*\{[^}]*\bLlmAdapter\b[^}]*\}\s*from\s*["']@deepseek-ai\/dsh-llm["']/,
    )
    expect(built).toMatch(/session\/set_config_option/)
    expect(built).toMatch(/does not generate/)
  })
})
