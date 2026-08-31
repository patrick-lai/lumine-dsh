import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const entryPath = fileURLToPath(new URL('../lib/index.js', import.meta.url))
const describeBuilt = existsSync(entryPath) ? describe : describe.skip

describeBuilt('built skills loader entry', () => {
  it('links DSH peers before dynamically importing the plugin', () => {
    const entry = readFileSync(entryPath, 'utf8')
    expect(entry).toMatch(/ensureDshPeers/)
    expect(entry).toMatch(/import\(['"]\.\/plugin\.js['"]\)/)
  })
})
