import { describe, expect, it } from 'vitest'
import {
  AcpCatalogAdapter,
  AcpCatalogRegistry,
  catalogRoute,
  fallbackCatalog,
  grokSeedCatalog,
  hostSelectionCurrent,
  hostServesProvider,
  hostSessionModels,
  lastModelSelection,
  mountAcpCatalog,
  pickerSnapshot,
  seedSessionRoute,
  selectionFromCatalog,
} from '../src/models.ts'
import { createHostLikeLlm } from './host-llm.ts'

const DEEPSEEK_DEFAULT = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

describe('host session.models / session.prompt gate (live box failure)', () => {
  it('seedDefaults puts grok on listProviders so routeServed and groups are Grok', async () => {
    const llm = createHostLikeLlm()
    const registry = new AcpCatalogRegistry(llm)
    registry.seedDefaults()

    expect(llm.listProviders().map(entry => entry.id)).toEqual(['claude', 'codex', 'cursor', 'grok'])
    expect(hostServesProvider(llm, 'grok')).toBe(true)

    const grok = registry.adapter.projected('grok')
    expect(grok?.models.map(model => model.id)).toEqual(['grok-4.6', 'grok-4.5'])
    expect(grok?.currentModel).toBe('grok-4.6')
    expect(JSON.stringify(grok)).not.toMatch(/deepseek/i)
    expect(JSON.stringify(grok)).not.toMatch(/grok-4[^.]|grok-3/)

    const session = {
      events: [] as Array<{ type: string; data: unknown }>,
      append(type: string, data: unknown) {
        this.events.push({ type, data })
      },
    }
    const seeded = seedSessionRoute(session, grok ?? grokSeedCatalog())
    const picked = lastModelSelection(session.events)
    const current = hostSelectionCurrent({
      picked,
      defaultSelection: DEEPSEEK_DEFAULT,
    })
    const picker = pickerSnapshot(registry.adapter, current)
    const host = await hostSessionModels(llm, current)

    expect(seeded).toEqual({ provider: 'grok', model: 'grok-4.6', reasoningEffort: 'high' })
    expect(current).toEqual({ provider: 'grok', model: 'grok-4.6', reasoningEffort: 'high' })
    expect(picker.routable).toBe(true)
    expect(host.routable).toBe(true)
    expect(host.groups.map(group => group.id)).toEqual(['claude', 'codex', 'cursor', 'grok'])
    expect(host.groups.find(group => group.id === 'grok')?.models.map(model => model.id))
      .toEqual(['grok-4.6', 'grok-4.5'])
    expect(host.groups.some(group => group.id === 'deepseek-official')).toBe(false)
    expect(picker.groups.find(group => group.id === 'grok')?.models.map(model => model.id))
      .toEqual(['grok-4.6', 'grok-4.5'])
  })

  it('fails seedDefaults if listProviders does not include grok', () => {
    const errors: string[] = []
    const registry = new AcpCatalogRegistry({
      registerAdapter() {
        const handle = (() => {}) as { (): void; replace(next: string[]): void }
        handle.replace = () => {}
        return handle
      },
      listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
    }, { error: (message: unknown) => { errors.push(String(message)) } })
    expect(() => registry.seedDefaults()).toThrow(/listProviders\(\) missing/)
    expect(errors.join('\n')).toMatch(/listProviders\(\) missing claude, codex, cursor, grok/)
  })

  it('host prepareRoutes TypeError when providerRetryPolicy is missing', () => {
    const llm = createHostLikeLlm()
    const incomplete = {
      providerInfo: (id: string) => ({ id, name: id }),
    }
    expect(() => llm.registerAdapter(['grok'], incomplete as never)).toThrow(TypeError)
    expect(llm.listProviders()).toEqual([])
  })

  it('AcpCatalogAdapter implements the host LlmAdapter defaults', async () => {
    const adapter = new AcpCatalogAdapter()
    adapter.replace(grokSeedCatalog())
    expect(adapter.providerRetryPolicy('grok')).toBeUndefined()
    expect(adapter.imageRequestPricing('grok', 'grok-4.6')).toBeUndefined()
    const prepared = await adapter.prepareCall('grok', 'grok-4.6')
    expect(prepared.model).toMatchObject({ provider: 'grok', id: 'grok-4.6', name: 'Grok 4.6' })
    await expect(async () => {
      for await (const _chunk of prepared.stream({})) void _chunk
    }).rejects.toThrow(/does not generate/)
  })

  it('reproduces the live miss: selectionFor before model/selection keeps DeepSeek current', () => {
    const session = {
      events: [] as Array<{ type: string; data: unknown }>,
      append(type: string, data: unknown) {
        this.events.push({ type, data })
      },
    }
    const pickedAtSetup = lastModelSelection(session.events)
    seedSessionRoute(session, grokSeedCatalog())
    const current = hostSelectionCurrent({
      picked: pickedAtSetup,
      defaultSelection: DEEPSEEK_DEFAULT,
    })
    expect(current).toEqual(DEEPSEEK_DEFAULT)
    expect(lastModelSelection(session.events)?.provider).toBe('grok')
  })

  it('falls back to request/header when picked is empty, then agent-default-model', () => {
    expect(hostSelectionCurrent({
      requestHeader: { provider: 'grok', model: 'grok-4.6' },
      defaultSelection: DEEPSEEK_DEFAULT,
    })).toEqual({ provider: 'grok', model: 'grok-4.6' })
    expect(hostSelectionCurrent({ defaultSelection: DEEPSEEK_DEFAULT })).toEqual(DEEPSEEK_DEFAULT)
  })

  it('uses the Grok 1.0.5 seed as the grok fallback, not a placeholder id', () => {
    expect(fallbackCatalog('grok').models.map(model => model.id)).toEqual(['grok-4.6', 'grok-4.5'])
    expect(selectionFromCatalog(grokSeedCatalog())).toEqual({
      provider: 'grok',
      model: 'grok-4.6',
      reasoningEffort: 'high',
    })
  })

  it('reproduces the live second-prompt mix: grok + deepseek-v4-flash is unroutable', () => {
    const header = { provider: 'grok', model: 'deepseek-v4-flash' }
    const current = hostSelectionCurrent({
      requestHeader: header,
      defaultSelection: DEEPSEEK_DEFAULT,
    })
    expect(current).toEqual(header)
    expect(hostServesProvider({ listProviders: () => [{ id: 'deepseek-official' }] }, current.provider)).toBe(false)
    expect(hostServesProvider({ listProviders: () => [{ id: 'grok' }] }, 'grok')).toBe(true)
  })

  it('never pairs the ACP provider with agentOptions.model deepseek-v4-flash', () => {
    const mixed = { provider: 'grok' as const, model: 'deepseek-v4-flash' }
    expect(catalogRoute(grokSeedCatalog(), mixed)).toEqual({ provider: 'grok', model: 'grok-4.6' })
    expect(catalogRoute(grokSeedCatalog(), { provider: 'deepseek-official', model: 'deepseek-v4-flash' }))
      .toEqual({ provider: 'grok', model: 'grok-4.6' })
    expect(catalogRoute(grokSeedCatalog(), { provider: 'grok', model: 'grok-4.5' }))
      .toEqual({ provider: 'grok', model: 'grok-4.5' })
    expect(JSON.stringify(catalogRoute(grokSeedCatalog(), mixed))).not.toMatch(/deepseek/i)
  })

  it('mountAcpCatalog registers on the host llm from apply', async () => {
    const errors: string[] = []
    const llm = createHostLikeLlm()
    const effects: Array<() => unknown> = []
    const catalog = mountAcpCatalog({
      llm,
      logger: { error: (message: unknown) => { errors.push(String(message)) } },
      effect(fn: () => (() => unknown) | void) {
        const dispose = fn()
        if (dispose) effects.push(dispose)
      },
    })
    expect(llm.listProviders().map(entry => entry.id)).toEqual(['claude', 'codex', 'cursor', 'grok'])
    expect(hostServesProvider(llm, 'grok')).toBe(true)
    const host = await hostSessionModels(llm, { provider: 'grok', model: 'grok-4.6', reasoningEffort: 'high' })
    expect(host.routable).toBe(true)
    expect(host.groups.find(group => group.id === 'grok')?.models.map(model => model.id))
      .toEqual(['grok-4.6', 'grok-4.5'])
    expect(errors).toEqual([])
    effects[0]?.()
    expect(catalog.adapter.advertisedProviders()).toEqual(['claude', 'codex', 'cursor', 'grok'])
  })

  it('logs and rethrows when registerAdapter throws', () => {
    const errors: string[] = []
    const registry = new AcpCatalogRegistry({
      registerAdapter() {
        throw new TypeError('adapter.providerRetryPolicy is not a function')
      },
      listProviders: () => [],
    }, { error: (message: unknown) => { errors.push(String(message)) } })
    expect(() => registry.seedDefaults()).toThrow(TypeError)
    expect(errors.join('\n')).toMatch(/catalog adapter not registered: adapter\.providerRetryPolicy is not a function/)
  })
})
