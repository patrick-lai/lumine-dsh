import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Routine } from './types.ts'

export const STORE_VERSION = 1
export const FILE_NAME = 'routines.json'

export interface RoutineSnapshot {
  readonly version: number
  readonly routines: Routine[]
}

export interface RoutinePersist {
  readonly kind: 'file' | 'storageDomain'
  readonly path?: string
  load(): Promise<RoutineSnapshot>
  save(snapshot: RoutineSnapshot): Promise<void>
}

export interface HostLike {
  get?<T = unknown>(name: string): T | undefined
  logger?: { warn(...args: unknown[]): void }
}

export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DSH_HOME?.trim()
  if (fromEnv) {
    if (fromEnv === '~') return homedir()
    if (fromEnv.startsWith('~/') || fromEnv.startsWith('~\\')) return join(homedir(), fromEnv.slice(2))
    return fromEnv
  }
  return join(homedir(), '.dsh')
}

export function defaultStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(env), 'lumine-routines', FILE_NAME)
}

function emptySnapshot(): RoutineSnapshot {
  return { version: STORE_VERSION, routines: [] }
}

function decodeSnapshot(raw: unknown): RoutineSnapshot {
  if (typeof raw !== 'object' || raw === null) return emptySnapshot()
  const record = raw as { version?: unknown; routines?: unknown }
  const routines = Array.isArray(record.routines) ? record.routines as Routine[] : []
  return { version: STORE_VERSION, routines }
}

export function filePersist(path = defaultStorePath()): RoutinePersist {
  return {
    kind: 'file',
    path,
    async load() {
      if (!existsSync(path)) return emptySnapshot()
      try {
        return decodeSnapshot(JSON.parse(readFileSync(path, 'utf8')))
      } catch {
        return emptySnapshot()
      }
    },
    async save(snapshot) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      const tmp = `${path}.${process.pid}.tmp`
      writeFileSync(
        tmp,
        `${JSON.stringify({ version: STORE_VERSION, routines: snapshot.routines }, null, 2)}\n`,
        { mode: 0o600 },
      )
      renameSync(tmp, path)
      chmodSync(path, 0o600)
    },
  }
}

interface DomainTable {
  get(id: string): unknown
  put(id: string, value: unknown): Promise<unknown>
  delete?(id: string): Promise<unknown>
  entries?(): Iterable<[string, unknown]>
  keys?(): Iterable<string>
}

interface OpenDomain {
  table(name: string): DomainTable
  close(): Promise<void>
}

interface StorageDomainFacility {
  open(spec: unknown): Promise<OpenDomain>
}

const SNAPSHOT_KEY = 'snapshot'

async function tryStorageDomain(ctx: HostLike | undefined): Promise<RoutinePersist | undefined> {
  const facility = ctx?.get?.<StorageDomainFacility>('storageDomain')
  if (!facility || typeof facility.open !== 'function') return undefined
  try {
    let spec: unknown = {
      name: 'lumine_routines',
      version: STORE_VERSION,
      tables: { routines: {} },
    }
    try {
      const mod = await import('@deepseek-ai/dsh-storage-domain') as {
        defineDomain?: (input: unknown) => unknown
        domainTable?: (schema: unknown) => unknown
      }
      if (typeof mod.defineDomain === 'function') {
        const table = typeof mod.domainTable === 'function'
          ? mod.domainTable({ parse: (value: unknown) => value })
          : {}
        spec = mod.defineDomain({
          name: 'lumine_routines',
          version: STORE_VERSION,
          tables: { routines: table },
        })
      }
    } catch {
      // Official host without the published helper: try a duck-typed spec.
    }
    const domain = await facility.open(spec)
    const table = domain.table('routines')
    return {
      kind: 'storageDomain',
      async load() {
        const stored = table.get(SNAPSHOT_KEY)
        if (stored) return decodeSnapshot(stored)
        if (table.entries) {
          const routines: Routine[] = []
          for (const [key, value] of table.entries()) {
            if (key === SNAPSHOT_KEY || typeof value !== 'object' || value === null) continue
            routines.push(value as Routine)
          }
          return { version: STORE_VERSION, routines }
        }
        return emptySnapshot()
      },
      async save(snapshot) {
        await table.put(SNAPSHOT_KEY, { version: STORE_VERSION, routines: snapshot.routines })
      },
    }
  } catch (error: unknown) {
    ctx?.logger?.warn(
      `lumine-routines: storageDomain unavailable, using DSH_HOME json: ${error instanceof Error ? error.message : String(error)}`,
    )
    return undefined
  }
}

export async function openPersist(ctx?: HostLike, env: NodeJS.ProcessEnv = process.env): Promise<RoutinePersist> {
  return (await tryStorageDomain(ctx)) ?? filePersist(defaultStorePath(env))
}
