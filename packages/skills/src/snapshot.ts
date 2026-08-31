import { execFileSync } from 'node:child_process'

const GIT_TIMEOUT_MS = 8_000
const DIFF_CHARS = 12_000

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** Bounded git status+diff for /review, /pr-warden, /second-opinion. */
export function collectWorkspaceSnapshot(cwd: string | undefined): string {
  if (!cwd) return '(no workspace cwd on this session)'
  try {
    const status = git(cwd, ['status', '--short']).trim()
    const stat = git(cwd, ['diff', '--stat', 'HEAD']).trim()
    let diff = git(cwd, ['diff', 'HEAD']).trim()
    if (diff.length > DIFF_CHARS) {
      diff = `${diff.slice(0, DIFF_CHARS)}\n… truncated ${diff.length - DIFF_CHARS} chars`
    }
    return [
      `cwd: ${cwd}`,
      status || '(working tree clean)',
      stat || '(no diffstat)',
      diff || '(no unstaged/staged diff vs HEAD)',
    ].join('\n')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `cwd: ${cwd}\n(git snapshot failed: ${message.split('\n')[0]})`
  }
}
