import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/presets.ts', () => ({
  installPickerPresets: () => '/tmp/presets',
}))

vi.mock('../src/factory.ts', () => ({
  LumineAcpFactory: class LumineAcpFactory {},
}))

describe('plugin apply registers the catalog on the host llm', () => {
  it('mounts grok/claude/codex/cursor before constructing the factory', async () => {
    const { apply } = await import('../src/plugin.ts')
    const registered: string[][] = []
    const pluginConfigs: unknown[] = []
    const llm = {
      listProviders: () => (registered.at(-1) ?? []).map(id => ({ id, name: id })),
      registerAdapter(providers: string[]) {
        registered.push([...providers])
        const handle = (() => {}) as { (): void; replace(next: string[]): void }
        handle.replace = (next: string[]) => { registered.push([...next]) }
        return handle
      },
    }
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

    expect(registered[0]).toEqual(['claude', 'codex', 'cursor', 'grok'])
    expect(llm.listProviders().map(entry => entry.id)).toContain('grok')
    expect(pluginConfigs).toHaveLength(1)
    expect(pluginConfigs[0]).toMatchObject({
      defaultProvider: 'claude',
      permission: 'yolo',
    })
    expect((pluginConfigs[0] as { catalog?: { adapter?: { projected: (id: string) => unknown } } }).catalog
      ?.adapter?.projected('grok')).toMatchObject({
      provider: 'grok',
      currentModel: 'grok-4.6',
    })
  })
})
