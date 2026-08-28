import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/service.ts', () => ({
  RoutineService: class RoutineService {},
}))

import { apply, parseRoutineCommand, resolveConfig } from '../src/plugin.ts'

describe('plugin apply mounts the routine service', () => {
  it('constructs RoutineService with grok-build defaults', () => {
    const plugins: unknown[] = []
    const ctx = {
      plugin(plugin: unknown, config: unknown) {
        plugins.push({ plugin, config })
        return { ctx, dispose() {} }
      },
    }
    apply(ctx as never, {})
    expect(plugins).toHaveLength(1)
    expect(plugins[0]).toMatchObject({
      config: {
        defaultPreset: 'grok-build',
        tickMs: 15_000,
        staleAfterMs: 21_600_000,
        grindMaxTurns: 8,
      },
    })
  })

  it('parses the official /routine grammar', () => {
    expect(parseRoutineCommand('')).toEqual({ kind: 'list' })
    expect(parseRoutineCommand('create morning -- Review the inbox')).toEqual({
      kind: 'create',
      title: 'morning',
      prompt: 'Review the inbox',
      extra: '',
    })
    expect(parseRoutineCommand('enable abc')).toEqual({ kind: 'enable', id: 'abc', enabled: true })
    expect(parseRoutineCommand('run abc')).toEqual({ kind: 'run', id: 'abc' })
  })

  it('keeps resolveConfig from inventing a DeepSeek key', () => {
    const resolved = resolveConfig({})
    expect(JSON.stringify(resolved)).not.toMatch(/DEEPSEEK_API_KEY/)
    expect(resolved.defaultPreset).toBe('grok-build')
  })
})
