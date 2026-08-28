/**
 * Thin wrappers around the `leyline` CLI. Used as a fallback when an HTTP
 * feature is missing, and for `leyline remember --stage dreamer`.
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
  stdin?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  spawnImpl?: typeof spawn
}

export function runLeyline(options: RunLeylineOptions): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = options.env ?? process.env
  const binary = resolveLeylineBinary(env)
  if (!binary) return Promise.resolve({ code: 127, stdout: '', stderr: 'leyline binary not found' })
  return new Promise((resolve) => {
    const child = (options.spawnImpl ?? spawn)(binary, options.args, {
      cwd: options.cwd,
      env: { ...env, LEYLINE_HOME: leylineHome(env) },
      stdio: ['pipe', 'pipe', 'pipe'],
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
    if (options.stdin) child.stdin?.end(options.stdin)
    else child.stdin?.end()
  })
}

export async function leylineRecallJson(query: string, options: {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
} = {}): Promise<unknown | undefined> {
  const result = await runLeyline({
    args: ['recall', '--json', query],
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs,
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
  cwd?: string
  env?: NodeJS.ProcessEnv
}): Promise<boolean> {
  const result = await runLeyline({
    args: ['remember', '--stage', 'dreamer', '--title', input.title, '--workspace-id', input.workspaceId],
    cwd: input.cwd,
    stdin: input.body,
    env: input.env,
  })
  return result.code === 0
}
