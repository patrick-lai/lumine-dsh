import { describe, expect, it } from 'vitest'
import { resolveConfig, resolveWorktrees } from '../src/config.ts'
import {
  decodeState,
  detectRepoKind,
  encodeState,
  firstFree,
  isPooledWorktreePath,
  mainlineRefreshIsFresh,
  nextName,
  plausibleRemoteURL,
  poolRoot,
  poolsRoot,
  repoName,
  sha6,
  slug,
  upsertEntry,
  WORKTREES_LEAF,
} from '../src/worktree-pool.ts'

describe('worktree pool path math (Raphael-shaped)', () => {
  it('parses repo names from git remotes', () => {
    expect(repoName('git@bitbucket.org:atlassian/commission-ai-swift.git')).toBe('commission-ai-swift')
    expect(repoName('https://github.com/owner/repo.git')).toBe('repo')
    expect(repoName('ssh://git@github.com/o/r')).toBe('r')
  })

  it('builds a stable per-remote slug', () => {
    const remote = 'git@bitbucket.org:atlassian/commission-ai-swift.git'
    const id = slug(remote)
    expect(id.startsWith('commission-ai-swift-')).toBe(true)
    expect(id).toBe(slug(remote))
    expect(sha6(remote)).toHaveLength(6)
    expect(slug('git@github.com:other/commission-ai-swift.git')).not.toBe(id)
    expect(poolsRoot('/Users/x', true)).toBe(`/Users/x/atlassian/${WORKTREES_LEAF}`)
    expect(poolRoot('/Users/x', true, remote)).toBe(`/Users/x/atlassian/${WORKTREES_LEAF}/${id}`)
    expect(poolsRoot('/Users/x', false)).toBe(`/Users/x/${WORKTREES_LEAF}`)
    expect(poolRoot('/Users/x', false, remote)).toBe(`/Users/x/${WORKTREES_LEAF}/${id}`)
  })

  it('recognizes lumine and raphael pooled paths so we never nest trees', () => {
    expect(isPooledWorktreePath('/Users/x/atlassian/.lumine/worktrees/repo-abc123/1/repo')).toBe(true)
    expect(isPooledWorktreePath('/Users/x/.lumine/worktrees/repo-abc123/2/repo')).toBe(true)
    expect(isPooledWorktreePath('/Users/x/atlassian/.raphael/worktrees/repo-abc123/68/repo')).toBe(true)
    expect(isPooledWorktreePath('/Users/x/.raphael/worktrees/repo-abc123/2/repo')).toBe(true)
    expect(isPooledWorktreePath('/Users/x/atlassian/commission-ai-swift')).toBe(false)
    expect(isPooledWorktreePath('/Users/x/code/repo')).toBe(false)
  })

  it('ignores probe noise when reading a remote URL', () => {
    expect(plausibleRemoteURL('Connection refused')).toBeUndefined()
    expect(plausibleRemoteURL('')).toBeUndefined()
    expect(plausibleRemoteURL('git@github.com:o/r.git')).toBe('git@github.com:o/r.git')
    expect(plausibleRemoteURL('process is not in a debuggable environment\ngit@github.com:o/r.git'))
      .toBe('git@github.com:o/r.git')
  })

  it('classifies monorepos from root markers', () => {
    expect(detectRepoKind(new Set(['afm-tools']), false)).toEqual({ kind: 'monorepo', reason: 'AFM (afm-tools/)' })
    expect(detectRepoKind(new Set(['pnpm-workspace.yaml']), false).kind).toBe('monorepo')
    expect(detectRepoKind(new Set(['README.md']), true).kind).toBe('monorepo')
    expect(detectRepoKind(new Set(['README.md']), false)).toEqual({ kind: 'small' })
  })

  it('allocates sequential tree names and skips live owners', () => {
    let state = decodeState('{"worktrees":null}')
    expect(nextName(state)).toBe('1')
    state = upsertEntry(state, {
      name: '1',
      path: '/t/1/repo',
      created_at: '2026-01-01T00:00:00Z',
      owner_pid: 1,
    })
    expect(nextName(state)).toBe('2')
    expect(firstFree(state, () => true)).toBeUndefined()
    expect(firstFree(state, () => false)?.name).toBe('1')
    expect(decodeState(encodeState(state)).worktrees).toHaveLength(1)
  })

  it('treats a persisted mainline fetch as fresh only when ref and oid still match', () => {
    const now = 1_000_000
    expect(mainlineRefreshIsFresh({
      lastRefreshMillis: now - 60_000,
      recordedRef: 'origin/main',
      recordedOid: 'abc',
      currentRef: 'origin/main',
      currentOid: 'abc',
      nowMillis: now,
    })).toBe(true)
    expect(mainlineRefreshIsFresh({
      lastRefreshMillis: now - 60_000,
      recordedRef: 'origin/main',
      recordedOid: 'abc',
      currentRef: 'origin/main',
      currentOid: 'def',
      nowMillis: now,
    })).toBe(false)
  })

  it('resolves worktree config defaults', () => {
    const resolved = resolveWorktrees({ home: '/Users/x', atlassian: false })
    expect(resolved).toMatchObject({
      mode: 'auto',
      home: '/Users/x',
      atlassian: false,
      keepIdle: 10,
    })
    expect(resolveConfig({ worktrees: { mode: 'never' } }).worktrees?.mode).toBe('never')
    expect(resolveWorktrees({ keepIdle: -3 }).keepIdle).toBe(0)
  })
})
