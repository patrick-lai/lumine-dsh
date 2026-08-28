import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-typert-protocol', () => ({
  TypertRemoteService: class TypertRemoteService {
    ctx: unknown
    constructor(ctx: unknown) {
      this.ctx = ctx
    }
  },
  Remote() {},
  remoteMethods() {
    return []
  },
}))

import { filePersist } from '../src/persist.ts'
import { inject as pluginInject } from '../src/plugin.ts'
import { RoutineService } from '../src/service.ts'

const MIXINS: Record<string, string> = { interval: 'timer' }

function createCtx(injected: string[]) {
  const allowed = new Set(['fiber', 'effect', 'inject', 'get', 'plugin', 'on', ...injected])
  const backing = {
    fiber: { state: 2, assertActive() {}, dispose() {} },
    logger: { warn() {}, info() {}, error() {} },
    agents: { async create() { return { agent: { id: 's', send() {} }, dispose: async () => {} } } },
    sessions: { get() { return undefined } },
    interval: vi.fn(() => () => {}),
    effect() { return () => {} },
    inject(_deps: string[], callback: (inner: unknown) => void) {
      callback(proxy)
      return { dispose() {} }
    },
    get(name: string) {
      if (name === 'logger') return backing.logger
      return undefined
    },
  }
  const proxy = new Proxy(backing, {
    get(target, prop) {
      if (typeof prop !== 'string') return Reflect.get(target, prop)
      const service = MIXINS[prop] ?? prop
      if (!allowed.has(service) && !allowed.has(prop)) {
        throw new Error(`cannot get property "${prop}" without inject`)
      }
      return Reflect.get(target, prop)
    },
  })
  return { ctx: proxy, interval: backing.interval }
}

function options() {
  return {
    defaultPreset: 'grok-build' as const,
    tickMs: 30_000,
    staleAfterMs: 21_600_000,
    persist: filePersist(join(mkdtempSync(join(tmpdir(), 'lumine-routines-inject-')), 'routines.json')),
  }
}

describe('RoutineService cordis inject', () => {
  it('declares every constructor hard-get, including timer for ctx.interval', () => {
    expect(RoutineService.inject).toEqual(['agents', 'timer', 'sessions'])
    expect(pluginInject).toEqual(['agents', 'timer', 'sessions'])
    expect(RoutineService.inject).not.toContain('storageDomain')
    expect(RoutineService.inject).not.toContain('interval')
  })

  it('constructs without touching ctx.interval (r2 failed here before timer was injected)', () => {
    const { ctx, interval } = createCtx(['agents', 'timer', 'sessions'])
    expect(() => new RoutineService(ctx as never, options())).not.toThrow()
    expect(interval).not.toHaveBeenCalled()
  })

  it('throws on constructor hard-gets that are missing from the fiber inject', () => {
    expect(() => new RoutineService(createCtx(['agents']).ctx as never, options())).toThrow(
      /cannot get property "sessions" without inject/,
    )
    expect(() => new RoutineService(createCtx(['agents', 'timer']).ctx as never, options())).toThrow(
      /cannot get property "sessions" without inject/,
    )
  })

  it('subscribes ctx.interval only after start(), once timer is on the fiber', async () => {
    const { ctx, interval } = createCtx(['agents', 'timer', 'sessions'])
    const service = new RoutineService(ctx as never, options())
    expect(interval).not.toHaveBeenCalled()
    await service.start()
    expect(interval).toHaveBeenCalledTimes(1)
    expect(interval.mock.calls[0]?.[1]).toBe(30_000)
    await service.start()
    expect(interval).toHaveBeenCalledTimes(1)
  })

  it('does not probe typeof ctx.interval (that hard-get threw in r2)', async () => {
    const { ctx } = createCtx(['agents', 'sessions'])
    const service = new RoutineService(ctx as never, options())
    await expect(service.start()).rejects.toThrow(/cannot get property "interval" without inject/)
  })
})
