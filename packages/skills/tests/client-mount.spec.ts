import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/client/actions.tsx', () => ({
  SkillActions: function SkillActions() { return null },
}))
vi.mock('../src/client/worktree.tsx', () => ({
  WorktreeChip: function WorktreeChip() { return null },
  pathFromBound: () => 'main',
}))
vi.mock('../src/client/memory.tsx', () => ({
  MemoryRailAction: function MemoryRailAction() { return null },
}))
vi.mock('../src/client/worktrees-rail.tsx', () => ({
  WorktreesRailAction: function WorktreesRailAction() { return null },
}))

import { apply, inject } from '../src/client/index.ts'

describe('lumine-skills client mount', () => {
  it('registers the session header controls and left-rail footer actions', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
    const registered: Array<Record<string, unknown>> = []
    const ctx = {
      locale: {
        register: () => () => {},
        bind: () => (key: string) => key,
      },
      slots: {
        inject(_name: string, factory: () => unknown) { return factory() },
        register(options: Record<string, unknown>, component: unknown) {
          registered.push({ ...options, component })
          return options
        },
      },
      connection: { rpc: { call: vi.fn() } },
      effect(fn: () => unknown) { fn(); return () => {} },
    }

    apply(ctx as never)

    expect(registered).toHaveLength(4)
    expect(registered[0]).toMatchObject({
      name: 'conversation.session.header.actions',
      id: 'lumine-actions',
      order: 15,
    })
    expect(registered[1]).toMatchObject({
      name: 'conversation.session.header.utilities',
      id: 'lumine-worktree',
      order: 10,
    })
    expect(registered[2]).toMatchObject({
      name: 'sidebar.footer.action',
      id: 'lumine-worktrees',
      order: 12,
      locale: 'lumine-skills',
    })
    expect(registered[3]).toMatchObject({
      name: 'sidebar.footer.action',
      id: 'lumine-memory',
      order: 14,
      locale: 'lumine-skills',
    })
    expect(registered.every(entry => entry.children === undefined)).toBe(true)
  })

  it('uses only the four command execution lines', () => {
    const source = readFileSync(new URL('../src/client/actions.tsx', import.meta.url), 'utf8')
    expect(source).toContain("{ line: 'review'")
    expect(source).toContain("{ line: 'wayfinder'")
    expect(source).toContain("{ line: 'pr-warden'")
    expect(source).toContain("{ line: 'second-opinion'")
    expect(source).toContain("rpc.call('/api', 'commands/execute'")
    expect(source).toContain('line: commandExecuteLine(line)')
    expect(source).toContain('images: []')
    expect(source).toContain('aria-pressed={false}')
  })

  it('keeps Token Saver out of the Skills client slots', () => {
    const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
    expect(source).not.toContain("conversation.input.right")
    expect(source).not.toContain("settings.section")
    expect(source).not.toContain("id: 'token-saver'")
    expect(source).not.toContain("id: 'lumine-token-saver'")
  })

  it('uses the host status RPC paths and keeps the worktree chip visible', () => {
    const memory = readFileSync(new URL('../src/client/memory.tsx', import.meta.url), 'utf8')
    const worktrees = readFileSync(new URL('../src/client/worktrees-rail.tsx', import.meta.url), 'utf8')
    const worktree = readFileSync(new URL('../src/client/worktree.tsx', import.meta.url), 'utf8')
    const railCss = readFileSync(new URL('../src/client/rail.module.css', import.meta.url), 'utf8')
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh: { client: { inject: string[] } }
    }

    expect(memory).toContain("rpc.call('/api', 'leyline/status', { args: {} })")
    expect(worktrees).toContain("rpc.call('/api', 'worktree/list', { args: {} })")
    expect(worktree).toContain("rpc.call('/api', 'worktree/bound'")
    expect(worktree).toContain('args: { sessionId }')
    expect(worktree).not.toContain('return null')
    expect(worktree).toContain("setPath('main')")
    expect(packageJson.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-sidebar')
    expect(railCss).toContain('width: 36px')
    expect(railCss).toContain('height: 36px')
    expect(railCss).toContain('--dsw-alias-')
    expect(railCss).toContain('[class*="footerActions"]')
    expect(railCss).toContain('flex-direction: column')
  })
})
