import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DSH_PEERS, dshModuleRoots, ensureDshPeers, findPeerDirectory, packageRootFrom } from '../src/peers.ts'

describe('DSH peer resolution for link: installs', () => {
  it('treats lib/ and src/ as the package root', () => {
    expect(packageRootFrom(pathToFileURL(join('/tmp/pkg/lib/index.js')).href)).toBe('/tmp/pkg')
    expect(packageRootFrom(pathToFileURL(join('/tmp/pkg/src/index.ts')).href)).toBe('/tmp/pkg')
  })

  it('looks in DSH_HOME profiles and NODE_PATH', () => {
    const roots = dshModuleRoots({
      DSH_HOME: '/dsh-home',
      DSH_PROFILE: 'web',
      NODE_PATH: '/extra/node_modules',
    }, '/work')
    expect(roots).toContain('/dsh-home/profiles/web/node_modules')
    expect(roots).toContain('/dsh-home/profiles/node_modules')
    expect(roots).toContain('/extra/node_modules')
    expect(roots).toContain('/work/node_modules')
  })

  it('links missing peers from a fake DSH profile into the package node_modules', () => {
    const home = mkdtempSync(join(tmpdir(), 'lumine-dsh-peers-'))
    const profileModules = join(home, 'profiles', 'web', 'node_modules')
    const packageDir = mkdtempSync(join(tmpdir(), 'lumine-routines-pkg-'))
    for (const name of DSH_PEERS) {
      const dir = join(profileModules, ...name.split('/'))
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0' }))
    }
    expect(findPeerDirectory('@deepseek-ai/cordis', [profileModules])).toBe(
      join(profileModules, '@deepseek-ai', 'cordis'),
    )
    const fromUrl = pathToFileURL(join(packageDir, 'lib', 'index.js')).href
    const linked = ensureDshPeers(fromUrl, { DSH_HOME: home, DSH_PROFILE: 'web' }, packageDir)
    expect(linked).toEqual([...DSH_PEERS])
    expect(findPeerDirectory('@deepseek-ai/cordis', [join(packageDir, 'node_modules')])).toBe(
      join(packageDir, 'node_modules', '@deepseek-ai', 'cordis'),
    )
  })
})
