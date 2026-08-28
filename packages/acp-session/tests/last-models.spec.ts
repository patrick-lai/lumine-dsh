import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LastModelsStore, parseLastModels } from '../src/last-models.ts'

describe('LastModelsStore', () => {
  it('round-trips per-provider last-used picks and ignores junk', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'lumine-last-')), 'last-models.json')
    const store = new LastModelsStore(file)
    store.remember({ provider: 'claude', model: 'sonnet', reasoningEffort: 'high' })
    store.remember({ provider: 'grok', model: 'grok-4.5' })
    store.remember({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(store.recall('claude')).toEqual({ model: 'sonnet', reasoningEffort: 'high' })
    expect(store.recall('grok')).toEqual({ model: 'grok-4.5' })
    expect(store.recall('cursor')).toBeUndefined()
    expect(store.recall('deepseek-official')).toBeUndefined()

    const reloaded = new LastModelsStore(file)
    expect(reloaded.recall('claude')).toEqual({ model: 'sonnet', reasoningEffort: 'high' })
    expect(reloaded.recall('grok')).toEqual({ model: 'grok-4.5' })
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1)
  })

  it('parses a truncated or foreign file as empty', () => {
    expect(parseLastModels('not json').byProvider).toEqual({})
    expect(parseLastModels('{"version":2,"byProvider":{"claude":{"model":"sonnet"}}}').byProvider).toEqual({})
    expect(parseLastModels('{"version":1,"byProvider":{"claude":{"model":"sonnet"},"nope":{"model":"x"}}}').byProvider)
      .toEqual({ claude: { model: 'sonnet' } })
  })
})
