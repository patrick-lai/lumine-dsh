import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/client/section.tsx', () => ({
  RoutinesSection: function RoutinesSection() {
    return null
  },
}))

vi.mock('../src/client/rail.tsx', () => ({
  RoutinesRailAction: function RoutinesRailAction() {
    return null
  },
}))

vi.mock('../src/client/stage.tsx', () => ({
  RoutinesStage: function RoutinesStage() {
    return null
  },
}))

import { apply, inject } from '../src/client/index.ts'
import { createRoutineWire } from '../src/client/rpc.ts'
import { RoutinesSettingsStore } from '../src/client/store.ts'
import { snapshotJsonValue } from './snapshot-json.ts'

describe('routines left-rail mount', () => {
  it('registers sidebar.footer.action and a thin settings deep-link', () => {
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
    expect(registered).toHaveLength(2)
    expect(registered[0]).toMatchObject({
      name: 'sidebar.footer.action',
      id: 'routines',
    })
    expect(registered[1]).toMatchObject({
      name: 'settings.section',
      id: 'routines',
    })
    const label = registered[0]?.label
    expect(typeof label).toBe('function')
    expect((label as () => string)()).toBe('Routines')
    expect(dictionaries[0]?.en.empty).toBe('No routines yet.')
    expect(dictionaries[0]?.en.settingsHint).toBe('Routines live on the left rail.')
    expect(JSON.stringify(registered)).not.toMatch(/Automations|Schedule/)
  })

  it('calls host routine/* RPC and keeps list payloads lossless', async () => {
    const calls: Array<{ endpoint: string; args: Record<string, unknown> }> = []
    const routines = [{
      id: 'r1',
      title: 'nightly',
      promptTemplate: 'ping',
      parameters: {},
      enabled: false,
      timezone: 'Australia/Sydney',
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
    expect(snap.open).toBe(false)
    expect(snap.rows).toEqual([])
    expect(snapshotJsonValue({ routines: snap.rows })).toEqual({ routines: [] })
    store.togglePane()
    expect(store.store.getSnapshot().open).toBe(true)
  })

  it('creates a cron + quiet-hours row paused with Australia/Sydney', async () => {
    const calls: Array<{ endpoint: string; args: Record<string, unknown> }> = []
    const store = new RoutinesSettingsStore({
      async call(_route, endpoint, payload) {
        calls.push({ endpoint, args: payload.args })
        if (endpoint === 'routine/create') {
          return {
            routine: {
              id: 'r2',
              ...(payload.args.input as object),
              enabled: false,
              parameters: {},
              mode: 'cron',
              createdAt: 1,
              updatedAt: 1,
              runCount: 0,
              deliveryFailures: 0,
              runs: [],
            },
          }
        }
        if (endpoint === 'routine/list') return { routines: [] }
        return {}
      },
    })
    store.beginCreate()
    store.setDraft({
      title: 'nightly',
      prompt: 'ping the board',
      kind: 'cron',
      cron: '0 9 * * 1-5',
      timezone: 'Australia/Sydney',
      quietEnabled: true,
      quietStart: '22:00',
      quietEnd: '07:00',
      quietWeekdays: [1, 2, 3, 4, 5, 6, 7],
    })
    await store.confirmCreate()
    const create = calls.find(item => item.endpoint === 'routine/create')
    expect(create?.args.input).toMatchObject({
      title: 'nightly',
      promptTemplate: 'ping the board',
      timezone: 'Australia/Sydney',
      rule: { kind: 'cron', cron: '0 9 * * 1-5' },
      quietHours: {
        timeZoneIdentifier: 'Australia/Sydney',
        startMinute: 22 * 60,
        endMinute: 7 * 60,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
      },
    })
  })
})
