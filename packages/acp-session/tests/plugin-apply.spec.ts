import { describe, expect, it, vi } from 'vitest'
import { createHostLikeLlm } from './host-llm.ts'

vi.mock('../src/presets.ts', () => ({
  installPickerPresets: () => '/tmp/presets',
}))

vi.mock('../src/factory.ts', () => ({
  LumineAcpFactory: class LumineAcpFactory {},
}))

describe('plugin apply registers the catalog on the host llm', () => {
  it('mounts grok/claude/codex/cursor before constructing the factory', async () => {
    const { apply } = await import('../src/plugin.ts')
    const pluginConfigs: unknown[] = []
    const llm = createHostLikeLlm()
    const ctx = {
      logger: { warn() {}, error() {}, info() {} },
      llm,
      plugin(_plugin: unknown, config: unknown) {
        pluginConfigs.push(config)
        return { ctx, dispose() {} }
      },
      effect(fn: () => (() => unknown) | void) {
        return fn() ?? (() => {})
      },
      get() { return undefined },
    }

    apply(ctx as never)

    expect(llm.listProviders().map(entry => entry.id)).toEqual(['claude', 'codex', 'cursor', 'grok'])
    expect(pluginConfigs).toHaveLength(1)
    expect(pluginConfigs[0]).toMatchObject({
      defaultProvider: 'claude',
      permission: 'yolo',
    })
    const catalog = (pluginConfigs[0] as { catalog?: { adapter?: { projected: (id: string) => { provider?: string; currentModel?: string } | undefined } } }).catalog
      ?.adapter
    expect(catalog?.projected('grok')).toMatchObject({
      provider: 'grok',
      currentModel: 'grok-4.6',
    })
    expect(catalog?.projected('claude')).toMatchObject({
      provider: 'claude',
      currentModel: 'default',
    })
    expect(catalog?.projected('cursor')).toMatchObject({
      provider: 'cursor',
      currentModel: 'composer-2',
    })
    expect(catalog?.projected('codex')).toMatchObject({
      provider: 'codex',
      currentModel: 'codex',
    })
  })
})
