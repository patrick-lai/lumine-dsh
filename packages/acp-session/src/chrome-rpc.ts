import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { readFileSync, readdirSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { lastBoundWorktree } from './events.ts'
import { leylineMcpServers } from './mcp.ts'
import {
  STATE_FILE,
  decodeState,
  detectAtlassian,
  entriesOf,
  isFree,
  poolsRoot,
  resolveHome,
} from './worktree-pool.ts'

export interface WorktreeChromeEntry {
  name: string
  path: string
  busy: boolean
  goal?: string
  agent?: string
}

export interface WorktreeChromeList {
  root: string
  trees: WorktreeChromeEntry[]
}

export interface LeylineChromeStatus {
  binary: string | null
  mounted: boolean
  args: ['serve', '--stdio']
}

export function listWorktrees(env: NodeJS.ProcessEnv = process.env): WorktreeChromeList {
  const home = resolveHome(env.HOME)
  const root = poolsRoot(home, detectAtlassian(home))
  let directories: Dirent[]

  try {
    directories = readdirSync(root, { withFileTypes: true })
  } catch {
    return { root, trees: [] }
  }

  const trees: WorktreeChromeEntry[] = []
  for (const directory of directories) {
    if (!directory.isDirectory()) continue

    try {
      const state = decodeState(readFileSync(join(root, directory.name, STATE_FILE), 'utf8'))
      for (const entry of entriesOf(state)) {
        trees.push({
          name: entry.name,
          path: entry.path,
          busy: !isFree(entry),
          ...(entry.goal == null ? {} : { goal: entry.goal }),
          ...(entry.agent == null ? {} : { agent: entry.agent }),
        })
      }
    } catch {
      // A missing or unreadable pool state contributes no worktrees.
    }
  }

  return { root, trees }
}

export function boundWorktree(session: {
  events: ReadonlyArray<{ type: string; data: unknown }>
  header?: { cwd?: string }
} | undefined): string | null {
  if (!session) return null
  const bound = lastBoundWorktree(session.events)
  if (bound) return bound
  const cwd = session.header?.cwd
  return typeof cwd === 'string' && cwd.startsWith('/') ? cwd : null
}

export function leylineStatus(env: NodeJS.ProcessEnv = process.env): LeylineChromeStatus {
  const servers = leylineMcpServers(env)
  return {
    binary: servers[0]?.command ?? null,
    mounted: servers.length > 0,
    args: ['serve', '--stdio'],
  }
}

export class WorktreeChromeService extends TypertRemoteService {
  static inject = ['sessions']

  constructor(ctx: Context) {
    super(ctx, 'worktree', { namespace: 'worktree' })
  }

  list(): WorktreeChromeList {
    return listWorktrees()
  }

  bound(sessionId: string): { path: string | null } {
    return { path: boundWorktree(this.ctx.sessions.get(sessionId as never)) }
  }
}

export class LeylineChromeService extends TypertRemoteService {
  static inject: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'leyline', { namespace: 'leyline' })
  }

  status(): LeylineChromeStatus {
    return leylineStatus()
  }
}

// Node 22 cannot parse decorator syntax in emitted JavaScript. Invoke the
// published TC39 decorator initializer explicitly, as routines does.
function installRemoteMarkers(ctor: { prototype: object }, methodNames: string[]): void {
  const decorate = Remote as unknown as (
    method: (...args: never[]) => unknown,
    context: {
      kind: string
      private: boolean
      static: boolean
      name: string
      addInitializer(initializer: (this: object) => void): void
    },
  ) => void

  for (const methodName of methodNames) {
    const method = (ctor.prototype as Record<string, unknown>)[methodName]
    if (typeof method !== 'function') continue
    decorate(method as (...args: never[]) => unknown, {
      kind: 'method',
      private: false,
      static: false,
      name: methodName,
      addInitializer(initializer) { initializer.call(Object.create(ctor.prototype)) },
    })
  }
}

installRemoteMarkers(WorktreeChromeService, ['list', 'bound'])
installRemoteMarkers(LeylineChromeService, ['status'])
