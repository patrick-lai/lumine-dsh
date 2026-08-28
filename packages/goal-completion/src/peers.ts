/**
 * Make `@deepseek-ai/cordis` (and the other DSH peers) resolvable from this
 * package directory. `link:` installs load `@lumine/dsh-goal-completion` from
 * its real path (`packages/goal-completion`), so Node never walks the DSH
 * profile `node_modules` where those peers actually live.
 *
 * This module must not import any `@deepseek-ai/*` package.
 */
import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DSH_PEERS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-goal',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-tools',
] as const

export function packageRootFrom(fromUrl: string): string {
  const file = fileURLToPath(fromUrl)
  let dir = dirname(file)
  if (dir.endsWith(`${sep}lib`)) dir = dirname(dir)
  if (dir.endsWith(`${sep}src`)) dir = dirname(dir)
  return dir
}

function tryResolve(name: string, fromUrl: string): string | undefined {
  const require = createRequire(fromUrl)
  try {
    return dirname(require.resolve(`${name}/package.json`))
  } catch {
    try {
      return dirname(require.resolve(name))
    } catch {
      return undefined
    }
  }
}

export function dshModuleRoots(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string[] {
  const roots: string[] = []
  const homeRaw = env.DSH_HOME?.trim()
  const home = !homeRaw
    ? join(homedir(), '.dsh')
    : homeRaw === '~'
      ? homedir()
      : homeRaw.startsWith('~/') || homeRaw.startsWith('~\\')
        ? join(homedir(), homeRaw.slice(2))
        : homeRaw
  const profile = env.DSH_PROFILE?.trim()
  if (profile) roots.push(join(home, 'profiles', profile, 'node_modules'))
  for (const name of ['web', 'headless', 'sdk', 'acp']) {
    roots.push(join(home, 'profiles', name, 'node_modules'))
  }
  roots.push(join(home, 'profiles', 'node_modules'))
  if (env.NODE_PATH) {
    for (const part of env.NODE_PATH.split(/[:;]/)) {
      if (part.trim()) roots.push(part.trim())
    }
  }
  let dir = cwd
  for (let index = 0; index < 10; index += 1) {
    roots.push(join(dir, 'node_modules'))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return roots
}

export function findPeerDirectory(name: string, roots: readonly string[]): string | undefined {
  const parts = name.split('/')
  for (const root of roots) {
    const pkg = join(root, ...parts, 'package.json')
    if (existsSync(pkg)) return dirname(pkg)
  }
  return undefined
}

function linkPeer(source: string, dest: string): boolean {
  try {
    mkdirSync(dirname(dest), { recursive: true })
    if (existsSync(dest)) {
      try {
        if (lstatSync(dest).isSymbolicLink() && readlinkSync(dest) === source) return true
      } catch {
        return false
      }
      return true
    }
    symlinkSync(source, dest, 'dir')
    return true
  } catch {
    return false
  }
}

/**
 * Symlink missing DSH peers into this package's `node_modules` so the
 * subsequent dynamic `import('./plugin.js')` can resolve them.
 */
export function ensureDshPeers(
  fromUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string[] {
  const linked: string[] = []
  const destRoot = join(packageRootFrom(fromUrl), 'node_modules')
  const roots = dshModuleRoots(env, cwd)
  for (const name of DSH_PEERS) {
    if (tryResolve(name, fromUrl)) {
      linked.push(name)
      continue
    }
    const source = findPeerDirectory(name, roots)
    if (source === undefined) continue
    if (linkPeer(source, join(destRoot, ...name.split('/')))) linked.push(name)
  }
  return linked
}
