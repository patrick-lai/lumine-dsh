/**
 * Thin wrappers around the live `leyline` CLI.
 *
 * Argv is pinned to clap in leyline-agent-memory `RememberArgs` / `RecallArgs`:
 * `remember` requires `--title` and `--body` (stdin is not a body source).
 * `recall` requires `--query` (not a positional).
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { leylineHome } from './discover.ts'

export function resolveLeylineBinary(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.LEYLINE_BIN?.trim()) return env.LEYLINE_BIN.trim()
  const home = leylineHome(env)
  for (const candidate of [
    join(home, 'bin', 'leyline'),
    join(homedir(), '.local', 'bin', 'leyline'),
  ]) {
    if (existsSync(candidate)) return candidate
  }
  const path = env.PATH ?? ''
  for (const dir of path.split(':')) {
    const candidate = join(dir, 'leyline')
    if (dir && existsSync(candidate)) return candidate
  }
  return undefined
}

export interface RunLeylineOptions {
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  spawnImpl?: typeof spawn
}

/** Live `leyline remember --help`: --title and --body are required. --lane is shown. */
export function rememberDreamerArgs(input: {
  title: string
  body: string
  workspaceId: string
  repoId?: string
  lane?: string
}): string[] {
  const args = [
    'remember',
    '--stage', 'dreamer',
    '--title', input.title,
    '--body', input.body,
    '--workspace-id', input.workspaceId,
    '--lane', input.lane?.trim() || 'repo',
  ]
  if (input.repoId) args.push('--repo-id', input.repoId)
  return args
}

/** Live `leyline recall --help`: --query is required, not a positional. */
export function recallJsonArgs(input: {
  query: string
  workspaceId?: string
  repoId?: string
  maxMemories?: number
}): string[] {
  const args = ['recall', '--query', input.query, '--json']
  if (input.workspaceId) args.push('--workspace-id', input.workspaceId)
  if (input.repoId) args.push('--repo-id', input.repoId)
  if (input.maxMemories !== undefined) args.push('--max-memories', String(input.maxMemories))
  return args
}

export function runLeyline(options: RunLeylineOptions): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = options.env ?? process.env
  const binary = resolveLeylineBinary(env)
  if (!binary) return Promise.resolve({ code: 127, stdout: '', stderr: 'leyline binary not found' })
  return new Promise((resolve) => {
    const child = (options.spawnImpl ?? spawn)(binary, options.args, {
      cwd: options.cwd,
      env: { ...env, LEYLINE_HOME: leylineHome(env) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => { stdout += String(chunk) })
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: 124, stdout, stderr })
    }, options.timeoutMs ?? 8000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: 127, stdout, stderr })
    })
  })
}

export async function leylineRecallJson(query: string, options: {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  workspaceId?: string
  repoId?: string
  maxMemories?: number
  spawnImpl?: typeof spawn
} = {}): Promise<unknown | undefined> {
  const result = await runLeyline({
    args: recallJsonArgs({
      query,
      workspaceId: options.workspaceId,
      repoId: options.repoId,
      maxMemories: options.maxMemories,
    }),
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs,
    spawnImpl: options.spawnImpl,
  })
  if (result.code !== 0 || !result.stdout.trim()) return undefined
  try {
    return JSON.parse(result.stdout)
  } catch {
    return undefined
  }
}

export async function leylineRememberDreamer(input: {
  title: string
  body: string
  workspaceId: string
  repoId?: string
  lane?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  spawnImpl?: typeof spawn
}): Promise<boolean> {
  const result = await runLeyline({
    args: rememberDreamerArgs(input),
    cwd: input.cwd,
    env: input.env,
    spawnImpl: input.spawnImpl,
  })
  return result.code === 0
}
