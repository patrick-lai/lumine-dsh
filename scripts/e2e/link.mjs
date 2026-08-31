#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const repoRoot = resolve(process.cwd())
const linkDependency = `link:${repoRoot}`
const profileDir = join(homedir(), '.dsh', 'profiles', 'web')
const args = ['plugin', '--profile', 'web', 'add', linkDependency]

function linkDir(source, dest) {
  mkdirSync(dirname(dest), { recursive: true })
  try {
    const stat = lstatSync(dest)
    if (stat.isSymbolicLink() && readlinkSync(dest) === source) return
    unlinkSync(dest)
  } catch {
    // dest missing
  }
  symlinkSync(source, dest, 'dir')
}

/** Cordis resolves `@lumine/*` from the profile, not from nested lumine-dsh node_modules. */
async function linkScopedPackages() {
  const packagesRoot = join(repoRoot, 'packages')
  const scopedRoot = join(profileDir, 'node_modules', '@lumine')
  mkdirSync(scopedRoot, { recursive: true })
  for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const pkgFile = join(packagesRoot, entry.name, 'package.json')
    if (!existsSync(pkgFile)) continue
    const manifest = JSON.parse(await readFile(pkgFile, 'utf8'))
    const name = typeof manifest.name === 'string' ? manifest.name : ''
    if (!name.startsWith('@lumine/')) continue
    linkDir(join(packagesRoot, entry.name), join(scopedRoot, name.slice('@lumine/'.length)))
    console.log(`linked ${name} -> ${join(packagesRoot, entry.name)}`)
  }
  linkDir(repoRoot, join(profileDir, 'node_modules', 'lumine-dsh'))
  console.log(`linked lumine-dsh -> ${repoRoot}`)
}

console.log(['dsh', ...args].join(' '))
const linked = spawnSync('dsh', args, { stdio: 'inherit' })

if (linked.error || linked.status !== 0) {
  const profilePackage = join(profileDir, 'package.json')
  let manifest

  try {
    manifest = JSON.parse(await readFile(profilePackage, 'utf8'))
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error
    manifest = { private: true }
  }

  if (!manifest.dependencies || typeof manifest.dependencies !== 'object' || Array.isArray(manifest.dependencies)) {
    manifest.dependencies = {}
  }
  manifest.dependencies['lumine-dsh'] = linkDependency

  await mkdir(dirname(profilePackage), { recursive: true })
  await writeFile(profilePackage, `${JSON.stringify(manifest, null, 2)}\n`)

  const reason = linked.error
    ? linked.error.message
    : `dsh exited with status ${linked.status}`
  console.log(`dsh plugin relink failed (${reason}).`)
  console.log(`Updated ${profilePackage} with lumine-dsh=${linkDependency}.`)

  const storeDir = join(homedir(), 'Library', 'pnpm', 'store', 'v11')
  spawnSync('pnpm', [
    'install',
    '--no-frozen-lockfile',
    `--store-dir=${storeDir}`,
    '--ignore-scripts',
  ], { cwd: profileDir, stdio: 'inherit' })
}

await linkScopedPackages()
console.log(`Web profile @lumine/* now points at ${repoRoot}. Restart DSH or run pnpm e2e:fresh to load the new plugins.`)
