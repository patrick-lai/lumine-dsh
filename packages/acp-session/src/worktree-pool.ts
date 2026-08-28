import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Raphael-shaped worktree pool (pure): path math, slug, on-disk state.
 * Trees live under `<base>/.lumine/worktrees/<repo>-<sha6(remote)>/<n>/<repo>`
 * so they never collide with Raphael's `.raphael/worktrees` owner stamps.
 */

export const WORKTREES_LEAF = '.lumine/worktrees'
export const RAPHAEL_WORKTREES_LEAF = '.raphael/worktrees'
export const STATE_FILE = 'treehouse-state.json'
export const LOCK_FILE = 'treehouse-state.lock'
export const DEFAULT_KEEP_IDLE = 10
export const MAINLINE_FRESHNESS_MS = 6 * 60 * 60 * 1000

export type RepoKind =
  | { kind: 'monorepo'; reason: string }
  | { kind: 'small' }

export function repoName(remote: string): string {
  let s = remote.trim()
  if (s.endsWith('.git')) s = s.slice(0, -4)
  const scheme = s.indexOf('://')
  if (scheme >= 0) s = s.slice(scheme + 3)
  const at = s.lastIndexOf('@')
  if (at >= 0) s = s.slice(at + 1)
  s = s.replaceAll(':', '/')
  const parts = s.split('/').filter(part => part.length > 0)
  return parts.at(-1) ?? 'repo'
}

/** First probe line that can be a git remote. Sentences (whitespace) are noise. */
export function plausibleRemoteURL(output: string): string | undefined {
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || /\s/.test(line)) continue
    return line
  }
  return undefined
}

export function sha6(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 6)
}

export function slug(remote: string): string {
  return `${repoName(remote)}-${sha6(remote)}`
}

export function detectAtlassian(home: string): boolean {
  return existsSync(join(home, 'atlassian'))
}

export function worktreesBase(home: string, atlassian: boolean): string {
  return atlassian ? `${home}/atlassian` : home
}

export function poolsRoot(home: string, atlassian = true): string {
  return `${worktreesBase(home, atlassian)}/${WORKTREES_LEAF}`
}

export function poolRoot(home: string, atlassian: boolean, remote: string): string {
  return `${poolsRoot(home, atlassian)}/${slug(remote)}`
}

export function treePath(pool: string, name: string, repo: string): string {
  return join(pool, name, repo)
}

export function isPooledWorktreePath(path: string): boolean {
  return path.endsWith(`/${WORKTREES_LEAF}`)
    || path.includes(`/${WORKTREES_LEAF}/`)
    || path.endsWith(`/${RAPHAEL_WORKTREES_LEAF}`)
    || path.includes(`/${RAPHAEL_WORKTREES_LEAF}/`)
}

export function detectRepoKind(contents: Set<string>, packageHasWorkspaces: boolean): RepoKind {
  if (contents.has('afm-tools')) return { kind: 'monorepo', reason: 'AFM (afm-tools/)' }
  if (packageHasWorkspaces) return { kind: 'monorepo', reason: 'package.json workspaces' }
  if (contents.has('pnpm-workspace.yaml')) return { kind: 'monorepo', reason: 'pnpm workspaces' }
  if (contents.has('lerna.json') || contents.has('nx.json')) return { kind: 'monorepo', reason: 'lerna/nx' }
  if (contents.has('WORKSPACE') || contents.has('WORKSPACE.bazel') || contents.has('MODULE.bazel')) {
    return { kind: 'monorepo', reason: 'bazel workspace' }
  }
  return { kind: 'small' }
}

export interface PoolEntry {
  name: string
  path: string
  created_at: string
  owner_pid?: number | null
  owner_started_at?: number | null
  goal?: string | null
  parked?: boolean | null
  agent?: string | null
  model?: string | null
  fastPassHead?: string | null
  provision_ok?: boolean | null
  provision_note?: string | null
  provision_at_ms?: number | null
}

export interface ProvisionSnapshot {
  tree_name: string
  path: string
  head: string
  stamped_at_ms: number
  mode?: string | null
}

export interface PoolState {
  worktrees?: PoolEntry[] | null
  last_mainline_fetch_at_ms?: number | null
  last_mainline_ref?: string | null
  last_mainline_oid?: string | null
  last_good_snapshot?: ProvisionSnapshot | null
}

export function entriesOf(state: PoolState): PoolEntry[] {
  return state.worktrees ?? []
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function isFree(entry: PoolEntry, alive: (pid: number) => boolean = pidAlive): boolean {
  if (entry.parked === true) return false
  if (entry.owner_pid == null) return true
  return !alive(entry.owner_pid)
}

export function firstFree(state: PoolState, alive: (pid: number) => boolean = pidAlive): PoolEntry | undefined {
  return entriesOf(state).find(entry => isFree(entry, alive))
}

export function nextName(state: PoolState): string {
  const max = entriesOf(state).reduce((n, entry) => {
    const parsed = Number.parseInt(entry.name, 10)
    return Number.isFinite(parsed) ? Math.max(n, parsed) : n
  }, 0)
  return String(max + 1)
}

export function upsertEntry(state: PoolState, entry: PoolEntry): PoolState {
  const list = [...entriesOf(state)]
  const index = list.findIndex(item => item.path === entry.path)
  if (index >= 0) list[index] = entry
  else list.push(entry)
  return { ...state, worktrees: list }
}

export function removeEntry(state: PoolState, path: string): PoolState {
  return { ...state, worktrees: entriesOf(state).filter(entry => entry.path !== path) }
}

export function entryBootable(entry: PoolEntry): boolean {
  return entry.provision_ok !== false
}

export function decodeState(raw: string): PoolState {
  try {
    const parsed = JSON.parse(raw) as PoolState
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function encodeState(state: PoolState): string {
  return `${JSON.stringify(state, null, 2)}\n`
}

export function mainlineRefreshIsFresh(opts: {
  lastRefreshMillis?: number | null
  recordedRef?: string | null
  recordedOid?: string | null
  currentRef?: string | null
  currentOid?: string | null
  nowMillis: number
  windowMs?: number
}): boolean {
  const windowMs = opts.windowMs ?? MAINLINE_FRESHNESS_MS
  if (windowMs <= 0) return false
  const last = opts.lastRefreshMillis
  if (last == null || opts.recordedRef == null || opts.recordedOid == null) return false
  if (opts.nowMillis < last) return false
  if (opts.recordedRef !== opts.currentRef || opts.recordedOid !== opts.currentOid) return false
  return opts.nowMillis - last < windowMs
}

export function resolveHome(home?: string): string {
  return home && home.length > 0 ? home : homedir()
}
