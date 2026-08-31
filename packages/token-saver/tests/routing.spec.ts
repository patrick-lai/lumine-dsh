import { describe, expect, it } from 'vitest'
import { routeSubagent } from '../src/routing.ts'

describe('spawn-time token saver routing', () => {
  it('passes off and light through', () => {
    const requested = { model: 'grok-4.6', effort: 'high' }
    expect(routeSubagent('off', requested)).toBe(requested)
    expect(routeSubagent('light', requested)).toBe(requested)
  })

  it('lowers effort without re-pointing Grok', () => {
    const requested = { model: 'grok-4.6', effort: 'high' }
    expect(routeSubagent('balanced', requested)).toEqual({ model: 'grok-4.6', effort: 'low' })
    expect(requested).toEqual({ model: 'grok-4.6', effort: 'high' })
    expect(routeSubagent('aggressive', { model: 'other', effort: 'high' }).effort).toBe('low')
  })
})
