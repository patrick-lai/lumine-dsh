import { describe, expect, it } from 'vitest'
import {
  AcpCatalogRegistry,
  fallbackCatalog,
  grokSeedCatalog,
  hostSelectionCurrent,
  lastModelSelection,
  pickerSnapshot,
  seedSessionRoute,
  selectionFromCatalog,
} from '../src/models.ts'

const DEEPSEEK_DEFAULT = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

function fakeLlm() {
  const registered: string[][] = []
  return {
    registered,
    registerAdapter(providers: string[]) {
      registered.push([...providers])
      const handle = (() => {}) as { (): void; replace(next: string[]): void }
      handle.replace = (next: string[]) => { registered.push([...next]) }
      return handle
    },
  }
}

describe('host session.models / session.prompt gate (live box failure)', () => {
  it('registers Grok 4.6/4.5 at apply, before any ACP child', () => {
    const llm = fakeLlm()
    const registry = new AcpCatalogRegistry(llm)
    registry.seedDefaults()

    expect(llm.registered[0]).toEqual(['claude', 'codex', 'cursor', 'grok'])
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
    // Host setup calls selectionFor() here — picked must already be Grok.
    const picked = lastModelSelection(session.events)
    const current = hostSelectionCurrent({
      picked,
      defaultSelection: DEEPSEEK_DEFAULT,
    })
    const picker = pickerSnapshot(registry.adapter, current)

    expect(seeded).toEqual({ provider: 'grok', model: 'grok-4.6', reasoningEffort: 'high' })
    expect(current.provider).toBe('grok')
    expect(current.provider).not.toBe('deepseek-official')
    expect(current.model).toBe('grok-4.6')
    expect(picker.routable).toBe(true)
    expect(picker.groups.map(group => group.id)).toEqual(['claude', 'codex', 'cursor', 'grok'])
    expect(picker.groups.find(group => group.id === 'grok')?.models.map(model => model.id))
      .toEqual(['grok-4.6', 'grok-4.5'])
    expect(picker.groups.some(group => group.id === 'deepseek-official')).toBe(false)
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
})
