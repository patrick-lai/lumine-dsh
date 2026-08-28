/**
 * Find an already-running Leyline daemon, then optionally attach-or-spawn.
 * Order: LEYLINE_BASE_URL → $LEYLINE_HOME/daemon.json → :6868 → :7893.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { LeylineClient } from './client.ts'
import { DEFAULT_BIND } from './config.ts'

export const CANDIDATE_PORTS = [6868, 7893] as const

export interface DiscoverOptions {
  explicitBaseUrl?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  spawnIfMissing?: boolean
  fetchImpl?: typeof fetch
  spawnImpl?: typeof spawn
  which?: (command: string) => string | undefined
}

export interface DiscoverResult {
  baseUrl: string | undefined
  source: 'config' | 'env' | 'daemon.json' | 'probe' | 'spawn' | 'none'
  spawned?: ChildProcess
}

export function leylineHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.LEYLINE_HOME?.trim()
  if (!raw) return join(homedir(), '.leyline')
  if (raw === '~') return homedir()
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return join(homedir(), raw.slice(2))
  return raw
}

export function readDaemonJson(home: string): string | undefined {
  const path = join(home, 'daemon.json')
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      base_url?: unknown
      baseUrl?: unknown
      url?: unknown
      port?: unknown
    }
    const url = [parsed.base_url, parsed.baseUrl, parsed.url].find(value => typeof value === 'string' && value.trim())
    if (typeof url === 'string') return url.replace(/\/+$/, '')
    if (typeof parsed.port === 'number' && Number.isFinite(parsed.port)) {
      return `http://127.0.0.1:${Math.trunc(parsed.port)}`
    }
  } catch {
    return undefined
  }
  return undefined
}

export function candidateBaseUrls(options: DiscoverOptions = {}): string[] {
  const env = options.env ?? process.env
  const seen = new Set<string>()
  const out: string[] = []
  const push = (value: string | undefined): void => {
    const url = value?.trim().replace(/\/+$/, '')
    if (!url || seen.has(url)) return
    seen.add(url)
    out.push(url)
  }
  push(options.explicitBaseUrl)
  push(env.LEYLINE_BASE_URL)
  push(readDaemonJson(leylineHome(env)))
  for (const port of CANDIDATE_PORTS) push(`http://127.0.0.1:${port}`)
  return out
}

export async function probeBaseUrl(
  baseUrl: string,
  options: DiscoverOptions = {},
): Promise<boolean> {
  const client = new LeylineClient({
    baseUrl,
    timeoutMs: options.timeoutMs ?? 1500,
    fetchImpl: options.fetchImpl,
  })
  const result = await client.request('GET', '/v1/dashboard/snapshot')
  return result.ok
}

function whichOnPath(command: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const path = env.PATH ?? ''
  for (const dir of path.split(':')) {
    const candidate = join(dir, command)
    if (dir && existsSync(candidate)) return candidate
  }
  return undefined
}

export async function discoverLeyline(options: DiscoverOptions = {}): Promise<DiscoverResult> {
  const env = options.env ?? process.env
  const candidates = candidateBaseUrls(options)
  for (const [index, baseUrl] of candidates.entries()) {
    if (await probeBaseUrl(baseUrl, options)) {
      const source = options.explicitBaseUrl && index === 0
        ? 'config'
        : env.LEYLINE_BASE_URL?.replace(/\/+$/, '') === baseUrl
          ? 'env'
          : readDaemonJson(leylineHome(env)) === baseUrl
            ? 'daemon.json'
            : 'probe'
      return { baseUrl, source }
    }
  }
  if (options.spawnIfMissing === false) return { baseUrl: undefined, source: 'none' }
  const binary = (options.which ?? whichOnPath)('leyline', env)
  if (!binary) return { baseUrl: undefined, source: 'none' }
  const spawnImpl = options.spawnImpl ?? spawn
  const child = spawnImpl(binary, ['serve', '--bind', '127.0.0.1:6868'], {
    detached: true,
    stdio: 'ignore',
    env: { ...env, LEYLINE_HOME: leylineHome(env) },
  })
  child.unref?.()
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 150))
    if (await probeBaseUrl(DEFAULT_BIND, options)) {
      return { baseUrl: DEFAULT_BIND, source: 'spawn', spawned: child }
    }
  }
  return { baseUrl: undefined, source: 'none', spawned: child }
}
