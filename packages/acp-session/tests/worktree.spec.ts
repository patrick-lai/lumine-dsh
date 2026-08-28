import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveWorktrees } from '../src/config.ts'
import {
  acquireWorktree,
  canonicalize,
  defaultGitExec,
  mapWorkspaceIntoTree,
  PARALLEL_CHECKOUT,
  releaseWorktree,
  resolveStartPoint,
} from '../src/worktree.ts'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim()
}

function initRepo(prefix: string): { root: string; origin: string } {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const origin = `${root}.origin.git`
  git(root, ['init', '-b', 'main'])
  git(root, ['config', 'user.email', 'worktree@test'])
  git(root, ['config', 'user.name', 'Worktree Test'])
  writeFileSync(join(root, 'README.md'), 'main\n')
  mkdirSync(join(root, 'pkg'))
  writeFileSync(join(root, 'pkg', 'app.ts'), 'export {}\n')
  git(root, ['add', '.'])
  git(root, ['commit', '-m', 'main'])
  execFileSync('git', ['init', '--bare', origin], { encoding: 'utf8' })
  git(root, ['remote', 'add', 'origin', origin])
  git(root, ['push', '-u', 'origin', 'main'])
  return { root, origin }
}

const trash: string[] = []

afterEach(() => {
  for (const dir of trash.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
    rmSync(`${dir}.origin.git`, { recursive: true, force: true })
  }
})

describe('worktree acquire (live git)', { timeout: 30_000 }, () => {
  it('starts a new tree from main, not the picker feature HEAD', async () => {
    const { root } = initRepo('lumine-wt-base-')
    trash.push(root)
    const main = git(root, ['rev-parse', 'HEAD'])
    git(root, ['checkout', '-b', 'feature'])
    writeFileSync(join(root, 'feature.txt'), 'nope\n')
    git(root, ['add', 'feature.txt'])
    git(root, ['commit', '-m', 'feature'])
    const feature = git(root, ['rev-parse', 'HEAD'])
    expect(feature).not.toBe(main)

    const home = mkdtempSync(join(tmpdir(), 'lumine-wt-home-'))
    trash.push(home)
    const config = resolveWorktrees({ mode: 'auto', home, atlassian: false, keepIdle: 10 })
    const acquired = await acquireWorktree({ cwd: root, config, sessionId: 'sess-1' })
    expect(acquired).toBeDefined()
    expect(git(acquired!.path, ['rev-parse', 'HEAD'])).toBe(main)
    expect(git(acquired!.path, ['rev-parse', '--abbrev-ref', 'HEAD'])).toMatch(/^lumine\//)
    expect(acquired!.path).toContain('.lumine/worktrees/')
    expect(acquired!.path).not.toBe(root)

    await releaseWorktree(acquired!, config)
  })

  it('maps a package subdirectory into the pooled tree', async () => {
    const { root } = initRepo('lumine-wt-sub-')
    trash.push(root)
    const home = mkdtempSync(join(tmpdir(), 'lumine-wt-home-'))
    trash.push(home)
    const config = resolveWorktrees({ mode: 'auto', home, atlassian: false })
    const acquired = await acquireWorktree({ cwd: join(root, 'pkg'), config })
    expect(acquired?.cwd).toBe(join(acquired!.path, 'pkg'))
    expect(mapWorkspaceIntoTree(root, join(root, 'pkg'), acquired!.path)).toBe(join(acquired!.path, 'pkg'))
    await releaseWorktree(acquired!, config)
  })

  it('reuses a clean idle tree and refuses a dirty one', async () => {
    const { root } = initRepo('lumine-wt-reuse-')
    trash.push(root)
    const home = mkdtempSync(join(tmpdir(), 'lumine-wt-home-'))
    trash.push(home)
    const config = resolveWorktrees({ mode: 'auto', home, atlassian: false, keepIdle: 10 })

    const first = await acquireWorktree({ cwd: root, config, sessionId: 'a' })
    const path = first!.path
    await releaseWorktree(first!, config)

    const reused = await acquireWorktree({ cwd: root, config, sessionId: 'b' })
    expect(reused?.path).toBe(path)
    writeFileSync(join(reused!.path, 'wip.txt'), 'dirty\n')
    await releaseWorktree(reused!, config)

    const next = await acquireWorktree({ cwd: root, config, sessionId: 'c' })
    expect(next?.path).not.toBe(path)
    expect(next?.name).toBe('2')
    await releaseWorktree(next!, config)
  })

  it('resumes a dirty tree without resetting it', async () => {
    const { root } = initRepo('lumine-wt-resume-')
    trash.push(root)
    const home = mkdtempSync(join(tmpdir(), 'lumine-wt-home-'))
    trash.push(home)
    const config = resolveWorktrees({ mode: 'auto', home, atlassian: false })
    const first = await acquireWorktree({ cwd: root, config, sessionId: 'r1' })
    writeFileSync(join(first!.path, 'keep-me.txt'), 'live\n')
    const resumed = await acquireWorktree({
      cwd: root,
      config,
      sessionId: 'r1',
      resumePath: first!.cwd,
    })
    expect(resumed?.resumed).toBe(true)
    expect(resumed?.path).toBe(canonicalize(first!.path))
    expect(git(first!.path, ['status', '--porcelain'])).toMatch(/keep-me.txt/)
    await releaseWorktree(resumed!, config)
  })

  it('never passes checkout.workers=0', async () => {
    const seen: string[][] = []
    const exec: typeof defaultGitExec = async (cwd, args, opts) => {
      seen.push(args)
      return defaultGitExec(cwd, args, opts)
    }
    const { root } = initRepo('lumine-wt-workers-')
    trash.push(root)
    const home = mkdtempSync(join(tmpdir(), 'lumine-wt-home-'))
    trash.push(home)
    const config = resolveWorktrees({ mode: 'auto', home, atlassian: false })
    const acquired = await acquireWorktree({ cwd: root, config, exec })
    const add = seen.find(args => args.includes('worktree') && args.includes('add'))
    expect(add).toBeDefined()
    expect(add).toEqual(expect.arrayContaining([...PARALLEL_CHECKOUT]))
    expect(add?.join(' ')).not.toMatch(/checkout\.workers=0/)
    expect(await resolveStartPoint(root, undefined, exec)).toHaveLength(40)
    await releaseWorktree(acquired!, config)
  })

  it('skips pooling when mode is never', async () => {
    const { root } = initRepo('lumine-wt-never-')
    trash.push(root)
    const home = mkdtempSync(join(tmpdir(), 'lumine-wt-home-'))
    trash.push(home)
    const acquired = await acquireWorktree({
      cwd: root,
      config: resolveWorktrees({ mode: 'never', home, atlassian: false }),
    })
    expect(acquired).toBeUndefined()
  })

  it('always mode fails when cwd is not a git repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumine-wt-nogit-'))
    trash.push(dir)
    const home = mkdtempSync(join(tmpdir(), 'lumine-wt-home-'))
    trash.push(home)
    await expect(acquireWorktree({
      cwd: dir,
      config: resolveWorktrees({ mode: 'always', home, atlassian: false }),
    })).rejects.toThrow(/not a git repository/)
  })
})
