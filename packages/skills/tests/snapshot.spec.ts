import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectWorkspaceSnapshot } from '../src/snapshot.ts'

describe('workspace snapshot', () => {
  it('labels a missing cwd', () => {
    expect(collectWorkspaceSnapshot(undefined)).toMatch(/no workspace cwd/)
  })

  it('does not throw on a non-git directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumine-not-git-'))
    expect(collectWorkspaceSnapshot(dir)).toMatch(/git snapshot failed|not a git/)
  })
})
