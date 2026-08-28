import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/service.ts', () => ({
  RoutineService: class RoutineService {},
}))

import { apply, resolveConfig } from '../src/plugin.ts'

describe('plugin apply mounts the routine service', () => {
  it('constructs RoutineService with grok-build defaults and a 30s tick', () => {
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
        tickMs: 30_000,
        staleAfterMs: 21_600_000,
      },
    })
    expect(JSON.stringify(plugins[0])).not.toMatch(/grindMaxTurns/)
  })

  it('keeps resolveConfig from inventing a DeepSeek key', () => {
    const resolved = resolveConfig({})
    expect(JSON.stringify(resolved)).not.toMatch(/DEEPSEEK_API_KEY/)
    expect(resolved.defaultPreset).toBe('grok-build')
    expect(resolved.tickMs).toBe(30_000)
  })
})
