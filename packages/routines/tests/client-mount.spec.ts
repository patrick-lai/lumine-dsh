import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/client/section.tsx', () => ({
  RoutinesSection: function RoutinesSection() {
    return null
  },
}))

import { apply, inject } from '../src/client/index.ts'
import { createRoutineWire } from '../src/client/rpc.ts'
import { RoutinesSettingsStore } from '../src/client/store.ts'
import { snapshotJsonValue } from './snapshot-json.ts'

describe('routines settings section mount', () => {
  it('registers a top-level settings.section titled Routines', () => {
    expect(inject).toEqual(expect.arrayContaining(['slots', 'locale', 'connection']))
    const registered: Array<Record<string, unknown>> = []
    const dictionaries: Array<{ ns: string; en: Record<string, string> }> = []
    const ctx = {
      locale: {
        register(ns: string, dicts: { en: Record<string, string> }) {
          dictionaries.push({ ns, en: dicts.en })
          return () => {}
        },
        bind(ns: string) {
          const row = dictionaries.find(item => item.ns === ns)
          return (key: string) => row?.en[key] ?? key
        },
      },
      slots: {
        inject(name: string, factory: () => unknown) {
          factory()
          return name
        },
        register(options: Record<string, unknown>, component: unknown) {
          registered.push({ ...options, component })
          return options
        },
      },
      connection: { rpc: { call: async () => ({ routines: [] }) } },
      remote: { $on: () => () => {} },
      effect(fn: () => (() => unknown) | void) {
        fn()
        return () => {}
      },
      on() {
        return () => {}
      },
      get() {
        return undefined
      },
    }
    apply(ctx as never)
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      name: 'settings.section',
      id: 'routines',
    })
    const label = registered[0]?.label
    expect(typeof label).toBe('function')
    expect((label as () => string)()).toBe('Routines')
    expect(dictionaries[0]?.en.empty).toBe('No routines yet.')
    expect(JSON.stringify(registered[0])).not.toMatch(/Automations|Schedule/)
  })

  it('calls host routine/* RPC and keeps list payloads lossless', async () => {
    const calls: Array<{ endpoint: string; args: Record<string, unknown> }> = []
    const routines = [{
      id: 'r1',
      title: 'nightly',
      promptTemplate: 'ping',
      parameters: {},
      enabled: false,
      timezone: 'UTC',
      rule: { kind: 'manual' },
      mode: 'cron',
      createdAt: 1,
      updatedAt: 1,
      runCount: 0,
      deliveryFailures: 0,
      runs: [],
    }]
    const wire = createRoutineWire({
      async call(_route, endpoint, payload) {
        calls.push({ endpoint, args: payload.args })
        if (endpoint === 'routine/list') return { routines }
        if (endpoint === 'routine/enable') return { routine: { ...routines[0], enabled: payload.args.enabled } }
        return {}
      },
    })
    const listed = await wire.list()
    expect(calls[0]?.endpoint).toBe('routine/list')
    expect('nextRunAt' in listed.routines[0]!).toBe(false)
    expect(snapshotJsonValue(listed)).toEqual(listed)
    await wire.enable('r1', true)
    expect(calls[1]).toEqual({ endpoint: 'routine/enable', args: { id: 'r1', enabled: true } })
  })

  it('loads an empty list through the settings store', async () => {
    const store = new RoutinesSettingsStore({
      async call() {
        return { routines: [] }
      },
    })
    await store.load()
    const snap = store.store.getSnapshot()
    expect(snap.status).toBe('ready')
    expect(snap.rows).toEqual([])
    expect(snapshotJsonValue({ routines: snap.rows })).toEqual({ routines: [] })
  })
})
