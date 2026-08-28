import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/factory.ts', () => ({
  LumineAcpFactory: class LumineAcpFactory {},
}))

vi.mock('../src/presets.ts', () => ({
  installPickerPresets: () => '/tmp/presets',
}))

const OFFICIAL_AGENT_LOOP_INJECT = ['agents', 'sessions', 'llm', 'tools', 'systemPrompt']

describe('ACP factory inject matches official dsh-agent-loop', () => {
  it('plugin-root inject is the official five-name list', async () => {
    const { inject } = await import('../src/plugin.ts')
    expect(inject).toEqual(OFFICIAL_AGENT_LOOP_INJECT)
  })

  it('factory static inject in source matches official agent-loop exactly', () => {
    const factory = readFileSync(new URL('../src/factory.ts', import.meta.url), 'utf8')
    expect(factory).toMatch(
      /static inject = \['agents', 'sessions', 'llm', 'tools', 'systemPrompt'\]/,
    )
  })

  it('omitting tools is the r10 factory fiber that threw', async () => {
    const { inject } = await import('../src/plugin.ts')
    expect(inject).not.toEqual(['agents', 'sessions', 'llm', 'systemPrompt'])
    expect(inject).toContain('tools')
    expect(inject).toContain('systemPrompt')
  })
})
