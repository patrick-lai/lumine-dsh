import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { boundWorktree, leylineStatus, listWorktrees } from '../src/chrome-rpc.ts'
import { STATE_FILE, poolsRoot } from '../src/worktree-pool.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('worktree chrome RPC', () => {
  it('returns an empty pool without touching the real home directory', () => {
    const home = temporaryDirectory('lumine-chrome-worktrees-empty-')
    const root = poolsRoot(home, false)
    mkdirSync(join(root, 'pool-without-state'), { recursive: true })

    expect(listWorktrees({ HOME: home, PATH: '' })).toEqual({ root, trees: [] })
  })

  it('lists busy and free worktrees and omits null metadata', () => {
    const home = temporaryDirectory('lumine-chrome-worktrees-')
    const root = poolsRoot(home, false)
    const pool = join(root, 'lumine-dsh-abc123')
    mkdirSync(pool, { recursive: true })
    writeFileSync(join(pool, STATE_FILE), JSON.stringify({
      worktrees: [
        {
          name: '1',
          path: join(pool, '1', 'lumine-dsh'),
          created_at: '2026-08-29T00:00:00Z',
          owner_pid: process.pid,
          goal: 'Polish DSH chrome',
          agent: 'codex',
        },
        {
          name: '2',
          path: join(pool, '2', 'lumine-dsh'),
          created_at: '2026-08-29T00:00:00Z',
          owner_pid: null,
          goal: null,
          agent: null,
        },
      ],
    }))

    expect(listWorktrees({ HOME: home, PATH: '' })).toEqual({
      root,
      trees: [
        {
          name: '1',
          path: join(pool, '1', 'lumine-dsh'),
          busy: true,
          goal: 'Polish DSH chrome',
          agent: 'codex',
        },
        {
          name: '2',
          path: join(pool, '2', 'lumine-dsh'),
          busy: false,
        },
      ],
    })
  })
})

describe('bound worktree', () => {
  it('reads worktreePath from the latest request/context event', () => {
    expect(boundWorktree({
      events: [
        { type: 'request/context', data: { worktreePath: '/old/tree' } },
        { type: 'request/context', data: { worktreePath: '/Users/me/.lumine/worktrees/repo-abc/2/repo' } },
      ],
      header: { cwd: '/Users/me/repo' },
    })).toBe('/Users/me/.lumine/worktrees/repo-abc/2/repo')
  })

  it('falls back to session cwd and then null', () => {
    expect(boundWorktree({
      events: [{ type: 'user/message', data: {} }],
      header: { cwd: '/Users/me/repo' },
    })).toBe('/Users/me/repo')
    expect(boundWorktree(undefined)).toBeNull()
  })
})

describe('leyline chrome RPC', () => {
  it('reports a missing leyline binary', () => {
    expect(leylineStatus({ PATH: temporaryDirectory('lumine-chrome-empty-path-') })).toEqual({
      binary: null,
      mounted: false,
      args: ['serve', '--stdio'],
    })
  })

  it('reports a present leyline binary', () => {
    const directory = temporaryDirectory('lumine-chrome-leyline-bin-')
    const binary = join(directory, 'leyline')
    writeFileSync(binary, '#!/bin/sh\n')
    chmodSync(binary, 0o755)

    expect(leylineStatus({ PATH: directory })).toEqual({
      binary,
      mounted: true,
      args: ['serve', '--stdio'],
    })
  })
})
