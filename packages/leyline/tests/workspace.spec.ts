import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalizeRepoId, findGitRoot, isAbsoluteGitRoot, repoIdFromCwd, repoIdFromGitRoot } from '../src/workspace.ts'

describe('git workspace guards', () => {
  it('accepts only absolute existing git roots', () => {
    const root = mkdtempSync(join(tmpdir(), 'lumine-leyline-git-'))
    expect(isAbsoluteGitRoot(root)).toBe(false)
    mkdirSync(join(root, '.git'))
    expect(isAbsoluteGitRoot(root)).toBe(true)
    expect(isAbsoluteGitRoot('relative/path')).toBe(false)
    expect(isAbsoluteGitRoot('/no/such/dir')).toBe(false)
  })

  it('canonicalizes origin URLs and reads .git/config', () => {
    expect(canonicalizeRepoId('git@github.com:patrick-lai/lumine-dsh.git')).toBe('patrick-lai/lumine-dsh')
    expect(canonicalizeRepoId('https://github.com/patrick-lai/lumine-dsh.git')).toBe('patrick-lai/lumine-dsh')
    expect(canonicalizeRepoId('ssh://git@github.com/patrick-lai/lumine-dsh.git')).toBe('patrick-lai/lumine-dsh')
    const root = mkdtempSync(join(tmpdir(), 'lumine-leyline-origin-'))
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, '.git', 'config'), '[remote "origin"]\n\turl = git@github.com:Acme/Repo.git\n')
    expect(repoIdFromGitRoot(root)).toBe('Acme/Repo')
    const nested = join(root, 'packages', 'app')
    mkdirSync(nested, { recursive: true })
    expect(findGitRoot(nested)).toBe(root)
    expect(repoIdFromCwd(nested)).toBe('Acme/Repo')
  })
})
