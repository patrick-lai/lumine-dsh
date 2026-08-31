import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DSH_PEERS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-typert-protocol',
] as const

export const PROFILE_PACKAGE_NAME = '@lumine/dsh-token-saver'

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
    try { return dirname(require.resolve(name)) } catch { return undefined }
  }
}

function dshHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.DSH_HOME?.trim()
  if (!raw) return join(homedir(), '.dsh')
  if (raw === '~') return homedir()
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return join(homedir(), raw.slice(2))
  return raw
}

function moduleRoots(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string[] {
  const roots: string[] = []
  const home = dshHome(env)
  const profile = env.DSH_PROFILE?.trim()
  if (profile) roots.push(join(home, 'profiles', profile, 'node_modules'))
  for (const name of ['web', 'headless', 'sdk', 'acp']) roots.push(join(home, 'profiles', name, 'node_modules'))
  roots.push(join(home, 'profiles', 'node_modules'))
  if (env.NODE_PATH) {
    for (const root of env.NODE_PATH.split(/[:;]/)) if (root.trim()) roots.push(root.trim())
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

function findPeerDirectory(name: string, roots: readonly string[]): string | undefined {
  for (const root of roots) {
    const packagePath = join(root, ...name.split('/'), 'package.json')
    if (existsSync(packagePath)) return dirname(packagePath)
  }
  return undefined
}

function linkPeer(source: string, destination: string): boolean {
  try {
    mkdirSync(dirname(destination), { recursive: true })
    if (existsSync(destination)) {
      return lstatSync(destination).isSymbolicLink() && readlinkSync(destination) === source
    }
    symlinkSync(source, destination, 'dir')
    return true
  } catch {
    return false
  }
}

export function ensureDshPeers(
  fromUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string[] {
  const linked: string[] = []
  const destinationRoot = join(packageRootFrom(fromUrl), 'node_modules')
  const roots = moduleRoots(env, cwd)
  for (const name of DSH_PEERS) {
    if (tryResolve(name, fromUrl)) {
      linked.push(name)
      continue
    }
    const source = findPeerDirectory(name, roots)
    if (source && linkPeer(source, join(destinationRoot, ...name.split('/')))) linked.push(name)
  }
  return linked
}
