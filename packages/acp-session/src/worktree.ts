import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ResolvedWorktreeConfig } from './config.ts'
import {
  decodeState,
  encodeState,
  entriesOf,
  isFree,
  isPooledWorktreePath,
  LOCK_FILE,
  mainlineRefreshIsFresh,
  nextName,
  pidAlive,
  poolRoot,
  removeEntry,
  repoName,
  resolveHome,
  STATE_FILE,
  treePath,
  upsertEntry,
  type PoolEntry,
  type PoolState,
} from './worktree-pool.ts'
import { classifyReclaim, isClaimable, type WorktreeReclaimFacts } from './worktree-reclaim.ts'

const execFileAsync = promisify(execFile)

export const START_POINT_CANDIDATES = ['origin/master', 'origin/main', 'master', 'main'] as const

/** Parallel checkout: 4 workers, never 0 (0 = one worker per core and lags the machine). */
export const PARALLEL_CHECKOUT = ['-c', 'checkout.workers=4', '-c', 'checkout.thresholdForParallelism=100'] as const

const GIT_TIMEOUT_MS = 120_000
const WORKTREE_ADD_TIMEOUT_MS = 1_800_000
const LOCK_WAIT_MS = 15_000

export interface GitResult {
  code: number
  stdout: string
  stderr: string
}

export type GitExec = (cwd: string, args: string[], opts?: { timeoutMs?: number }) => Promise<GitResult>

export interface AcquiredWorktree {
  name: string
  path: string
  cwd: string
  repoRoot: string
  remote: string
  branch: string
  startPoint: string
  resumed: boolean
}

export class WorktreeError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'WorktreeError'
  }
}

export function isMainlineAlias(ref: string): boolean {
  let value = ref.trim().toLowerCase()
  if (value.startsWith('origin/')) value = value.slice('origin/'.length)
  return value === 'main' || value === 'master' || value === 'trunk' || value === 'head'
}

export function trackingRefFromSymref(symref: string): string | undefined {
  const value = symref.trim()
  if (!value) return undefined
  const prefix = 'refs/remotes/'
  const ref = value.startsWith(prefix) ? value.slice(prefix.length) : value
  return ref.length > 0 ? ref : undefined
}

export function canonicalize(path: string): string {
  const resolved = resolve(path)
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
}

export function mapWorkspaceIntoTree(repoRoot: string, cwd: string, treePathValue: string): string {
  const root = canonicalize(repoRoot)
  const from = canonicalize(cwd)
  const tree = canonicalize(treePathValue)
  const rel = relative(root, from)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return tree
  return join(tree, rel)
}

export async function defaultGitExec(cwd: string, args: string[], opts?: { timeoutMs?: number }): Promise<GitResult> {
  try {
    const result = await execFileAsync('git', ['-c', 'core.fsmonitor=false', ...args], {
      cwd,
      timeout: opts?.timeoutMs ?? GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    return { code: 0, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
  } catch (error: unknown) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean }
    if (failure.killed) {
      throw new WorktreeError(`git ${args.join(' ')} timed out`, 'GIT_TIMEOUT')
    }
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: String(failure.stdout ?? ''),
      stderr: String(failure.stderr ?? ''),
    }
  }
}

async function gitText(exec: GitExec, cwd: string, args: string[], timeoutMs?: number): Promise<string | undefined> {
  const result = await exec(cwd, args, timeoutMs === undefined ? undefined : { timeoutMs })
  if (result.code !== 0) return undefined
  const text = result.stdout.trim()
  return text.length > 0 ? text : undefined
}

async function gitOk(exec: GitExec, cwd: string, args: string[], timeoutMs?: number): Promise<boolean> {
  const result = await exec(cwd, args, timeoutMs === undefined ? undefined : { timeoutMs })
  return result.code === 0
}

async function gitRequire(exec: GitExec, cwd: string, args: string[], timeoutMs?: number): Promise<string> {
  const result = await exec(cwd, args, timeoutMs === undefined ? undefined : { timeoutMs })
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim() || `exit ${result.code}`
    throw new WorktreeError(`git ${args.join(' ')} failed: ${detail}`, 'GIT')
  }
  return result.stdout.trim()
}

export async function gitRepoRoot(cwd: string, exec: GitExec = defaultGitExec): Promise<string | undefined> {
  const root = await gitText(exec, cwd, ['rev-parse', '--show-toplevel'])
  return root ? canonicalize(root) : undefined
}

async function originRemote(repoRoot: string, exec: GitExec): Promise<string> {
  const direct = await gitText(exec, repoRoot, ['remote', 'get-url', 'origin'])
  if (direct) return direct
  const configured = await gitText(exec, repoRoot, ['config', '--get', 'remote.origin.url'])
  if (configured) return configured
  const listing = await gitText(exec, repoRoot, ['remote', '-v'])
  if (listing) {
    for (const line of listing.split(/\r?\n/)) {
      const match = line.match(/^\S+\s+(\S+)/)
      if (match?.[1]) return match[1]
    }
  }
  return `file://${resolve(repoRoot)}`
}

async function resolveCommit(repoRoot: string, ref: string, exec: GitExec): Promise<string | undefined> {
  return gitText(exec, repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`])
}

async function defaultBranchRef(repoRoot: string, exec: GitExec): Promise<string | undefined> {
  const symref = await gitText(exec, repoRoot, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
  if (symref) {
    const ref = trackingRefFromSymref(symref)
    if (ref && await resolveCommit(repoRoot, ref, exec)) return ref
  }
  for (const candidate of START_POINT_CANDIDATES) {
    if (await resolveCommit(repoRoot, candidate, exec)) return candidate
  }
  return undefined
}

async function refreshMainline(repoRoot: string, exec: GitExec, state: PoolState, now: number): Promise<PoolState> {
  const currentRef = await defaultBranchRef(repoRoot, exec)
  const currentOid = currentRef ? await resolveCommit(repoRoot, currentRef, exec) : undefined
  if (mainlineRefreshIsFresh({
    lastRefreshMillis: state.last_mainline_fetch_at_ms,
    recordedRef: state.last_mainline_ref,
    recordedOid: state.last_mainline_oid,
    currentRef,
    currentOid,
    nowMillis: now,
  })) return state
  const branch = currentRef?.replace(/^origin\//, '') ?? 'HEAD'
  const fetched = await exec(repoRoot, ['fetch', '--no-tags', '--quiet', 'origin', branch], {
    timeoutMs: GIT_TIMEOUT_MS,
  })
  if (fetched.code !== 0) return state
  const ref = await defaultBranchRef(repoRoot, exec)
  const oid = ref ? await resolveCommit(repoRoot, ref, exec) : undefined
  if (!ref || !oid) return state
  return {
    ...state,
    last_mainline_fetch_at_ms: now,
    last_mainline_ref: ref,
    last_mainline_oid: oid,
  }
}

/**
 * Fresh trees start from the refreshed default branch, never the picker HEAD
 * (a feature checkout or sibling worktree routinely carries unmerged commits).
 */
export async function resolveStartPoint(
  repoRoot: string,
  baseRef: string | undefined,
  exec: GitExec = defaultGitExec,
): Promise<string> {
  const resolveDefault = async (): Promise<string | undefined> => {
    const ref = await defaultBranchRef(repoRoot, exec)
    if (ref) {
      const sha = await resolveCommit(repoRoot, ref, exec)
      if (sha) return sha
    }
    for (const candidate of START_POINT_CANDIDATES) {
      const sha = await resolveCommit(repoRoot, candidate, exec)
      if (sha) return sha
    }
    return undefined
  }

  if (!baseRef) {
    return (await resolveDefault())
      ?? await gitRequire(exec, repoRoot, ['rev-parse', '--verify', 'HEAD'])
  }
  if (isMainlineAlias(baseRef)) {
    const sha = await resolveDefault()
    if (sha) return sha
  }
  const direct = await resolveCommit(repoRoot, baseRef, exec)
  if (direct) return direct
  if (isMainlineAlias(baseRef)) {
    const sha = await resolveDefault()
    if (sha) return sha
  }
  throw new WorktreeError(`base branch '${baseRef}' does not exist in this repo`, 'BASE_REF')
}

async function porcelain(path: string, exec: GitExec): Promise<{ tracked: boolean; untracked: boolean }> {
  const text = (await gitText(exec, path, ['status', '--porcelain', '--untracked-files=normal'])) ?? ''
  let tracked = false
  let untracked = false
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    if (line.startsWith('??') || line.startsWith('!!')) untracked = true
    else tracked = true
  }
  return { tracked, untracked }
}

async function reclaimFacts(path: string, mainline: string | undefined, exec: GitExec): Promise<WorktreeReclaimFacts> {
  const { tracked, untracked } = await porcelain(path, exec)
  const head = await gitText(exec, path, ['rev-parse', 'HEAD'])
  let isAncestorOfMainline = false
  let commitsAhead = 0
  if (head && mainline) {
    isAncestorOfMainline = await gitOk(exec, path, ['merge-base', '--is-ancestor', head, mainline])
    const counts = await gitText(exec, path, ['rev-list', '--count', `${mainline}..HEAD`])
    commitsAhead = Number.parseInt(counts ?? '0', 10) || 0
  }
  const containing = head
    ? await gitText(exec, path, ['branch', '-r', '--contains', head])
    : undefined
  const isPushedToRemote = Boolean(containing && containing.split(/\r?\n/).some(line => line.trim()))
  return {
    isAncestorOfMainline,
    hasMergedPR: false,
    hasOpenPR: false,
    isPushedToRemote,
    hasTrackedChanges: tracked,
    hasUntrackedFiles: untracked,
    commitsAhead,
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function withLock<T>(
  pool: string,
  fn: (state: PoolState) => Promise<{ value: T; state?: PoolState }> | { value: T; state?: PoolState },
): Promise<T> {
  await mkdir(pool, { recursive: true })
  const lockPath = join(pool, LOCK_FILE)
  const statePath = join(pool, STATE_FILE)
  const deadline = Date.now() + LOCK_WAIT_MS
  let handle: Awaited<ReturnType<typeof open>> | undefined
  while (handle === undefined) {
    try {
      handle = await open(lockPath, 'wx')
      await handle.writeFile(String(process.pid))
    } catch (error: unknown) {
      const code = (error as { code?: string }).code
      if (code !== 'EEXIST') throw error
      try {
        const owner = Number.parseInt(await readFile(lockPath, 'utf8'), 10)
        if (Number.isFinite(owner) && !pidAlive(owner)) await unlink(lockPath)
      } catch {
        // Lock raced or vanished.
      }
      if (Date.now() > deadline) throw new WorktreeError('worktree pool lock timed out', 'LOCK')
      await sleep(40)
    }
  }
  try {
    let state: PoolState = {}
    try {
      state = decodeState(await readFile(statePath, 'utf8'))
    } catch {
      state = {}
    }
    const result = await fn(state)
    if (result.state !== undefined) {
      const tmp = `${statePath}.${process.pid}.tmp`
      await writeFile(tmp, encodeState(result.state), 'utf8')
      await rename(tmp, statePath)
    }
    return result.value
  } finally {
    await handle.close().catch(() => undefined)
    await unlink(lockPath).catch(() => undefined)
  }
}

function uniqueBranch(name: string, sessionId?: string): string {
  const suffix = randomBytes(3).toString('hex')
  const session = sessionId?.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 24)
  return session ? `lumine/${session}-${name}-${suffix}` : `lumine/${name}-${suffix}`
}

async function addWorktree(
  repoRoot: string,
  path: string,
  startPoint: string,
  exec: GitExec,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const args = [...PARALLEL_CHECKOUT, 'worktree', 'add', '--detach', path, startPoint]
  const first = await exec(repoRoot, args, { timeoutMs: WORKTREE_ADD_TIMEOUT_MS })
  if (first.code === 0) return
  await scrubWorktree(repoRoot, path, exec)
  const retry = await exec(
    repoRoot,
    [...PARALLEL_CHECKOUT, 'worktree', 'add', '--force', '--force', '--detach', path, startPoint],
    { timeoutMs: WORKTREE_ADD_TIMEOUT_MS },
  )
  if (retry.code !== 0) {
    const detail = (retry.stderr || retry.stdout || first.stderr).trim()
    throw new WorktreeError(`git worktree add failed: ${detail}`, 'GIT')
  }
}

async function scrubWorktree(repoRoot: string, path: string, exec: GitExec): Promise<void> {
  await exec(repoRoot, ['worktree', 'unlock', path])
  await exec(repoRoot, ['worktree', 'remove', '--force', path], { timeoutMs: 300_000 })
  await exec(repoRoot, ['worktree', 'prune'])
  await rm(path, { recursive: true, force: true }).catch(() => undefined)
  await rm(dirname(path), { recursive: true, force: true }).catch(() => undefined)
}

async function checkoutFreshBranch(
  path: string,
  branch: string,
  startPoint: string,
  exec: GitExec,
): Promise<void> {
  await gitRequire(
    exec,
    path,
    [...PARALLEL_CHECKOUT, 'reset', '--hard', startPoint],
    WORKTREE_ADD_TIMEOUT_MS,
  )
  await gitRequire(exec, path, ['clean', '-fd'])
  await gitRequire(exec, path, ['checkout', '-B', branch, startPoint])
}

export interface AcquireOptions {
  cwd: string
  config: ResolvedWorktreeConfig
  sessionId?: string
  resumePath?: string
  agent?: string
  goal?: string
  baseRef?: string
  exec?: GitExec
  now?: () => number
}

export async function acquireWorktree(options: AcquireOptions): Promise<AcquiredWorktree | undefined> {
  if (options.config.mode === 'never') return undefined
  const exec = options.exec ?? defaultGitExec
  const now = options.now ?? Date.now
  const cwd = canonicalize(options.cwd)
  if (isPooledWorktreePath(cwd)) return undefined

  const repoRoot = await gitRepoRoot(cwd, exec)
  if (!repoRoot) {
    if (options.config.mode === 'always') {
      throw new WorktreeError(`not a git repository: ${cwd}`, 'NOT_GIT')
    }
    return undefined
  }

  if (options.resumePath) {
    const resumed = await resumeWorktree(options, repoRoot, cwd, exec, now)
    if (resumed) return resumed
  }

  const remote = await originRemote(repoRoot, exec)
  const home = resolveHome(options.config.home)
  const pool = poolRoot(home, options.config.atlassian, remote)
  const repo = repoName(remote)

  const startPoint = await withLock(pool, async state => {
    const refreshed = await refreshMainline(repoRoot, exec, state, now())
    const sha = await resolveStartPoint(repoRoot, options.baseRef, exec)
    return { value: sha, state: refreshed }
  })

  const reserved = await withLock(pool, async state => {
    const alive = pidAlive
    const free = entriesOf(state).filter(entry => isFree(entry, alive) && entry.provision_ok !== false)
    let chosen: PoolEntry | undefined
    for (const entry of free) {
      const inside = await gitText(exec, entry.path, ['rev-parse', '--is-inside-work-tree'])
      if (inside !== 'true') continue
      const facts = await reclaimFacts(entry.path, startPoint, exec)
      if (!isClaimable(classifyReclaim(facts))) continue
      chosen = entry
      break
    }
    const isNew = chosen === undefined
    if (isNew) {
      const name = nextName(state)
      chosen = {
        name,
        path: treePath(pool, name, repo),
        created_at: new Date(now()).toISOString(),
      }
    }
    const owned: PoolEntry = {
      ...chosen!,
      owner_pid: process.pid,
      owner_started_at: now(),
      parked: false,
      agent: options.agent ?? null,
      goal: options.goal ?? null,
      fastPassHead: null,
    }
    return {
      value: { entry: owned, isNew },
      state: upsertEntry(state, owned),
    }
  })

  const { entry, isNew } = reserved
  const branch = uniqueBranch(entry.name, options.sessionId)
  try {
    if (isNew) {
      await addWorktree(repoRoot, entry.path, startPoint, exec)
    }
    await checkoutFreshBranch(entry.path, branch, startPoint, exec)
    const materialized = canonicalize(entry.path)
    const head = await gitText(exec, materialized, ['rev-parse', 'HEAD'])
    await withLock(pool, async state => {
      const current = entriesOf(state).find(item => item.path === entry.path) ?? entry
      const stamped: PoolEntry = {
        ...current,
        path: materialized,
        provision_ok: true,
        provision_at_ms: now(),
        owner_pid: process.pid,
        owner_started_at: now(),
      }
      return {
        value: undefined,
        state: {
          ...upsertEntry(state, stamped),
          last_good_snapshot: head
            ? {
                tree_name: entry.name,
                path: entry.path,
                head,
                stamped_at_ms: now(),
                mode: isNew ? 'checkout' : 'reuse',
              }
            : state.last_good_snapshot,
        },
      }
    })
    return {
      name: entry.name,
      path: materialized,
      cwd: mapWorkspaceIntoTree(repoRoot, cwd, materialized),
      repoRoot,
      remote,
      branch,
      startPoint,
      resumed: false,
    }
  } catch (error: unknown) {
    await scrubWorktree(repoRoot, entry.path, exec)
    await withLock(pool, state => ({ value: undefined, state: removeEntry(state, entry.path) }))
    throw error
  }
}

async function resumeWorktree(
  options: AcquireOptions,
  repoRoot: string,
  cwd: string,
  exec: GitExec,
  now: () => number,
): Promise<AcquiredWorktree | undefined> {
  const resumePath = options.resumePath
  if (!resumePath) return undefined
  const inside = await gitText(exec, resumePath, ['rev-parse', '--is-inside-work-tree'])
  if (inside !== 'true') return undefined
  const treeRoot = await gitRepoRoot(resumePath, exec)
  if (!treeRoot) return undefined
  const resumeCwd = canonicalize(cwd)
  const remote = await originRemote(repoRoot, exec)
  const home = resolveHome(options.config.home)
  const pool = poolRoot(home, options.config.atlassian, remote)
  const branch = (await gitText(exec, treeRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])) ?? 'HEAD'
  const startPoint = (await gitText(exec, treeRoot, ['rev-parse', 'HEAD'])) ?? ''
  const name = await withLock(pool, state => {
    const existing = entriesOf(state).find(entry => entry.path === treeRoot)
    const entry: PoolEntry = {
      name: existing?.name ?? nextName(state),
      path: treeRoot,
      created_at: existing?.created_at ?? new Date(now()).toISOString(),
      owner_pid: process.pid,
      owner_started_at: now(),
      parked: false,
      agent: options.agent ?? existing?.agent,
      goal: options.goal ?? existing?.goal,
    }
    return { value: entry.name, state: upsertEntry(state, entry) }
  })
  return {
    name,
    path: treeRoot,
    cwd: mapWorkspaceIntoTree(repoRoot, resumeCwd, treeRoot),
    repoRoot,
    remote,
    branch,
    startPoint,
    resumed: true,
  }
}

export async function releaseWorktree(
  acquired: AcquiredWorktree,
  config: ResolvedWorktreeConfig,
  exec: GitExec = defaultGitExec,
): Promise<void> {
  const home = resolveHome(config.home)
  const pool = poolRoot(home, config.atlassian, acquired.remote)
  const mainline = await defaultBranchRef(acquired.path, exec)
  const facts = await reclaimFacts(acquired.path, mainline, exec)
  const verdict = classifyReclaim(facts)
  const head = await gitText(exec, acquired.path, ['rev-parse', 'HEAD'])
  const drop = await withLock(pool, async state => {
    const current = entriesOf(state).find(entry => entry.path === acquired.path)
    if (!current) return { value: false }
    const idle = entriesOf(state).filter(entry => (
      entry.path === acquired.path || isFree(entry)
    )).length
    const shouldDrop = isClaimable(verdict) && idle > config.keepIdle
    if (shouldDrop) {
      return { value: true, state: removeEntry(state, acquired.path) }
    }
    const released: PoolEntry = {
      ...current,
      owner_pid: null,
      owner_started_at: null,
      parked: false,
      fastPassHead: facts.hasTrackedChanges || facts.hasUntrackedFiles ? null : head,
    }
    return { value: false, state: upsertEntry(state, released) }
  })
  if (drop) await scrubWorktree(acquired.repoRoot, acquired.path, exec)
}
