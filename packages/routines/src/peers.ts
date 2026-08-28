/**
 * Make `@deepseek-ai/cordis` (and the other DSH peers) resolvable from this
 * package directory. `link:` installs load `@lumine/dsh-routines` from its
 * real path (`packages/routines`), so Node never walks the DSH profile
 * `node_modules` where those peers actually live.
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
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-storage-domain',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-typert-protocol',
] as const

/** Overlay `name` the official launch healer should already hoist from lumine-dsh. */
export const PROFILE_PACKAGE_NAME = '@lumine/dsh-routines'

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

export function dshHome(env: NodeJS.ProcessEnv = process.env): string {
  const homeRaw = env.DSH_HOME?.trim()
  if (!homeRaw) return join(homedir(), '.dsh')
  if (homeRaw === '~') return homedir()
  if (homeRaw.startsWith('~/') || homeRaw.startsWith('~\\')) return join(homedir(), homeRaw.slice(2))
  return homeRaw
}

export function dshModuleRoots(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string[] {
  const roots: string[] = []
  const home = dshHome(env)
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
/**
 * Heal a top-level profile symlink so overlay `name: '@lumine/dsh-routines'`
 * resolves without a hand link. Official launch already hoists `@lumine/*`
 * carried by the root bundle; this only writes the missing row.
 */
export function profileModuleRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = dshHome(env)
  const roots: string[] = []
  const profile = env.DSH_PROFILE?.trim()
  if (profile) roots.push(join(home, 'profiles', profile, 'node_modules'))
  roots.push(join(home, 'profiles', 'web', 'node_modules'))
  roots.push(join(home, 'profiles', 'node_modules'))
  return roots
}

export function ensureProfilePackageLink(
  fromUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const packageRoot = packageRootFrom(fromUrl)
  const linked: string[] = []
  const seen = new Set<string>()
  for (const root of profileModuleRoots(env)) {
    if (seen.has(root)) continue
    seen.add(root)
    const dest = join(root, ...PROFILE_PACKAGE_NAME.split('/'))
    if (linkPeer(packageRoot, dest)) linked.push(root)
  }
  return linked
}

/**
 * Symlink missing DSH peers into this package's `node_modules` so the
 * subsequent dynamic `import('./plugin.js')` can resolve them. Also heal
 * the profile `@lumine/dsh-routines` row when official hoist skipped it.
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
  ensureProfilePackageLink(fromUrl, env, cwd)
  return linked
}
