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
    expect(built).not.toMatch(
      /import\s*\{[^}]*\bFiberState\b[^}]*\}\s*from\s*["']@deepseek-ai\/cordis["']/,
    )
    const cordisImport = built.match(/import\s*\{([^}]*)\}\s*from\s*["']@deepseek-ai\/cordis["']/)
    if (cordisImport) {
      expect(cordisImport[1]).not.toMatch(/\bFiberState\b/)
    }
  })

  it('does not fabricate a DeepSeek key for the judge', () => {
    const built = readFileSync(new URL('../lib/plugin.js', import.meta.url), 'utf8')
    expect(built).not.toMatch(/DEEPSEEK_API_KEY/)
    expect(built).not.toMatch(/credentials\.set/)
  })
})
