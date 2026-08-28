import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/client/ToolGroupNode.tsx', () => ({
  ToolGroupNode: function ToolGroupNode() {
    return null
  },
}))

import { apply, inject } from '../src/client/index.ts'
import { SKIP_CSS } from '../src/client/skip-css.ts'

describe('lumine-chat client mount', () => {
  it('replaces conversation.chat.node key tool-call and declares tool.call.toolview children', () => {
    expect(inject).toEqual(['slots', 'locale'])
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
      effect(fn: () => (() => unknown) | void) {
        fn()
        return () => {}
      },
    }
    apply(ctx as never)
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      name: 'conversation.chat.node',
      key: 'tool-call',
      locale: 'lumine-chat',
    })
    const children = registered[0]?.children as { 'tool.call.toolview'?: { kind: string } }
    expect(children['tool.call.toolview']?.kind).toBe('keyed')
    expect(registered[0]?.component).toBeTypeOf('function')
    expect(dictionaries[0]?.en.actions).toBe('actions')
    expect(dictionaries[0]?.en.working).toBe('working…')
  })
})

describe('follower seat CSS', () => {
  it('hides ChatNodeSeat flow items that carry the skip marker', () => {
    expect(SKIP_CSS).toContain("[data-chat-flow-kind='tool-call']:has([data-lumine-tool-skip])")
    expect(SKIP_CSS).toContain('display:none!important')
    expect(SKIP_CSS).not.toContain(':global')
  })
})
