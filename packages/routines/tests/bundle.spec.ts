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

  it('exports a live TypertRemoteService the gateway can SRC-claim', () => {
    const built = readFileSync(new URL('../lib/plugin.js', import.meta.url), 'utf8')
    expect(built).toMatch(/TypertRemoteService/)
    expect(built).toMatch(/@deepseek-ai\/dsh-typert-protocol/)
    expect(built).toMatch(/super\([^,]+,\s*["']routine["']\)/)
    expect(built).toMatch(/installRoutineRemoteMarkers/)
    expect(built).toMatch(/\bRemote\b/)
    expect(built).toMatch(/addInitializer/)
    expect(built).not.toMatch(/rpc\.register/)
    expect(built).not.toMatch(/remotes\.register/)
    expect(built).not.toMatch(
      /import\s*\{[^}]*\bFiberState\b[^}]*\}\s*from\s*["']@deepseek-ai\/cordis["']/,
    )
    expect(built).toMatch(/new Set\(\[\s*3,\s*4,\s*5\s*\]\)/)
    expect(built).not.toMatch(/\bsetInterval\s*\(/)
    expect(built).not.toMatch(/['"]schedule\/change['"]/)
    expect(built).not.toMatch(/['"]schedule_create['"]/)
    expect(built).toMatch(/routine_list/)
    expect(built).toMatch(/routine_run_now/)
    expect(built).toMatch(/inject\s*=\s*\[\s*["']agents["']\s*,\s*["']timer["']\s*,\s*["']sessions["']\s*\]/)
    expect(built).not.toMatch(/typeof \S+\.interval/)
  })

  it('ships a lazy-CJS client factory for the Routines settings section', () => {
    const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    expect(client).toMatch(/window\.__ModuleLoader__\.load/)
    expect(client).toMatch(/@lumine\/dsh-routines/)
    expect(client).toMatch(/settings\.section/)
    expect(client).toMatch(/routines/)
    expect(client).toMatch(/No routines yet\./)
    expect(client).not.toMatch(/@deepseek-ai\/dsh-client-ui-settings\/client/)
    expect(client).not.toMatch(/from ["']@deepseek-ai\/dsh-client-ui-settings["']/)
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh?: { client?: { platform?: string; inject?: string[] } }
      exports?: Record<string, unknown>
    }
    expect(manifest.dsh?.client?.platform).toBe('web')
    expect(manifest.dsh?.client?.inject).toEqual(expect.arrayContaining([
      '@deepseek-ai/dsh-client-ui-settings',
    ]))
    expect(manifest.exports?.['./client']).toBeDefined()
  })
})
