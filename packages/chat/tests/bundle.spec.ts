import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('built lumine-chat loader entry', () => {
  it('exports an empty host apply without importing cordis', () => {
    const entry = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
    expect(entry).toMatch(/export \{[\s\S]*\bapply\b/)
    expect(entry).toMatch(/name\s*=\s*['"]lumine-chat['"]/)
    expect(entry).not.toMatch(/@deepseek-ai\/cordis/)
  })

  it('ships a lazy-CJS client factory that takes over the tool-call node', () => {
    const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    expect(client).toMatch(/window\.__ModuleLoader__\.load/)
    expect(client).toMatch(/@lumine\/dsh-chat/)
    expect(client).toMatch(/conversation\.chat\.node/)
    expect(client).toMatch(/tool-call/)
    expect(client).toMatch(/tool\.call\.toolview/)
    expect(client).toMatch(/data-subcalls/)
    expect(client).toMatch(/aria-hidden/)
    expect(client).toMatch(/aria-label/)
    expect(client).toMatch(/data-lumine-tool-skip/)
    expect(client).toMatch(/data-lumine-tool-group/)
    expect(client).toMatch(/data-chat-flow-kind='tool-call'/)
    expect(client).toMatch(/display:none!important/)
    expect(client).not.toMatch(/:global\(\[data-chat-flow-kind/)
    expect(client).not.toMatch(/from ["']@deepseek-ai\/dsh-client-ui-conversation["']/)
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh?: { client?: { platform?: string; inject?: string[] } }
      exports?: Record<string, unknown>
      files?: string[]
    }
    expect(manifest.dsh?.client?.platform).toBe('web')
    expect(manifest.dsh?.client?.inject).toEqual(expect.arrayContaining([
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-tool',
    ]))
    const clientExport = manifest.exports?.['./client'] as { types?: string; default?: string }
    expect(clientExport.types).toBe('./lib/client.d.ts')
    expect(clientExport.default).toBe('./lib/client.js')
    expect(manifest.files).toContain('lib')
    expect(manifest.files).not.toContain('src')
    expect(existsSync(new URL('../lib/client.d.ts', import.meta.url))).toBe(true)
    expect(readFileSync(new URL('../lib/client.d.ts', import.meta.url), 'utf8')).toMatch(/export function apply/)
  })
})
