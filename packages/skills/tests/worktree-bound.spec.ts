import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/client/worktree.tsx', import.meta.url), 'utf8')

describe('worktree chip bound RPC', () => {
  it('reads worktree/bound by sessionId instead of snapshot.events', () => {
    expect(source).toContain("rpc.call('/api', 'worktree/bound', { args: { sessionId } })")
    expect(source).not.toContain('snapshot?.events')
    expect(source).not.toContain('session?.events')
    expect(source).toContain("path.startsWith('/')")
    expect(source).toContain("return 'main'")
  })
})
