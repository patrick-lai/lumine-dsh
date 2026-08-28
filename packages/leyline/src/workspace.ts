/**
 * Git workspace guards for materialize. Absolute existing git roots only.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

export function isAbsoluteGitRoot(path: string | undefined): path is string {
  if (!path || !isAbsolute(path)) return false
  try {
    if (!statSync(path).isDirectory()) return false
  } catch {
    return false
  }
  const git = join(path, '.git')
  try {
    return existsSync(git)
  } catch {
    return false
  }
}

export function canonicalizeRepoId(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  let value = raw.trim()
  if (!value) return undefined
  value = value.replace(/\.git$/i, '')
  const ssh = value.match(/^git@[^:]+:(.+)$/)
  if (ssh?.[1]) value = ssh[1]
  else {
    try {
      value = new URL(value).pathname
    } catch {
      // already a path or owner/repo
    }
  }
  const parts = value.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  if (parts.length >= 2) return `${parts.at(-2)}/${parts.at(-1)}`
  return undefined
}

export function repoIdFromGitRoot(root: string): string | undefined {
  const configPath = join(root, '.git', 'config')
  let text = ''
  try {
    text = readFileSync(configPath, 'utf8')
  } catch {
    return undefined
  }
  const origin = text.match(/\[remote "origin"\][\s\S]*?url\s*=\s*(.+)/)
  return canonicalizeRepoId(origin?.[1])
}

export function workspaceQuery(cwd: string | undefined, fallback = 'session'): string {
  if (!cwd) return fallback
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.at(-1) || fallback
}
