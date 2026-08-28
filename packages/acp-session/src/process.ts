import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ResolvedLaunch } from './providers.ts'
import { childEnvironment } from './providers.ts'

export const DEFAULT_EOF_GRACE_MS = 6_000
export const DEFAULT_TERM_GRACE_MS = 3_000

export interface SpawnedChild {
  process: ChildProcessWithoutNullStreams
  dispose(): Promise<void>
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'))
    }
    if (signal?.aborted) {
      clearTimeout(timer)
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function waitExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise(resolve => child.once('exit', () => resolve()))
}

/**
 * Spawn the official product process. stdin/stdout are the ACP wire.
 * Dispose: stdin EOF → SIGTERM → SIGKILL.
 */
export function spawnOfficial(launch: ResolvedLaunch, cwd: string, parentEnv?: NodeJS.ProcessEnv): SpawnedChild {
  const env = childEnvironment(launch, parentEnv)
  const child = spawn(launch.command, launch.args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'inherit'],
  })

  let disposing: Promise<void> | undefined
  const dispose = (): Promise<void> => (disposing ??= (async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    try {
      child.stdin.end()
    } catch {
      // Child may already have closed stdin.
    }
    try {
      await Promise.race([waitExit(child), sleep(DEFAULT_EOF_GRACE_MS)])
    } catch {
      // Ignore wait interruptions.
    }
    if (child.exitCode !== null || child.signalCode !== null) return
    try {
      child.kill('SIGTERM')
    } catch {
      // Process may already be gone.
    }
    try {
      await Promise.race([waitExit(child), sleep(DEFAULT_TERM_GRACE_MS)])
    } catch {
      // Ignore wait interruptions.
    }
    if (child.exitCode !== null || child.signalCode !== null) return
    try {
      child.kill('SIGKILL')
    } catch {
      // Process may already be gone.
    }
    await waitExit(child)
  })())

  return { process: child, dispose }
}
