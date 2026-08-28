import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/factory.ts', () => ({
  LumineAcpFactory: class LumineAcpFactory {},
}))

vi.mock('../src/presets.ts', () => ({
  installPickerPresets: () => '/tmp/presets',
}))

describe('ACP factory inject includes systemPrompt (path C)', () => {
  it('plugin-root inject is agents, sessions, llm, plus systemPrompt', async () => {
    const { inject } = await import('../src/plugin.ts')
    expect(inject).toEqual(['agents', 'sessions', 'llm', 'systemPrompt'])
  })

  it('factory static inject in source lists the same systemPrompt grant', () => {
    const factory = readFileSync(new URL('../src/factory.ts', import.meta.url), 'utf8')
    expect(factory).toMatch(/static inject = \['agents', 'sessions', 'llm', 'systemPrompt'\]/)
    expect(factory).not.toMatch(/static inject = \['agents', 'sessions', 'llm'\]\s*$/m)
  })

  it('omitting systemPrompt is the r9 factory fiber that threw', async () => {
    const { inject } = await import('../src/plugin.ts')
    expect(inject).not.toEqual(['agents', 'sessions', 'llm'])
  })
})
