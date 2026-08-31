import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const TOKEN_SAVER_FILE = '.lumine-token-saver.json'
export const DEFAULT_TOKEN_SAVER_LEVEL = 'light' as const

export type TokenSaverLevel = 'off' | 'light' | 'balanced' | 'aggressive'
export interface TokenSaverState {
  level: TokenSaverLevel
}

export function parseLevel(value: unknown): TokenSaverLevel {
  return value === 'off' || value === 'light' || value === 'balanced' || value === 'aggressive'
    ? value
    : DEFAULT_TOKEN_SAVER_LEVEL
}

export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.DSH_HOME?.trim()
  if (!raw) return join(homedir(), '.dsh')
  if (raw === '~') return homedir()
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return join(homedir(), raw.slice(2))
  return raw
}

export function tokenSaverPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(env), TOKEN_SAVER_FILE)
}

export function load(env: NodeJS.ProcessEnv = process.env): TokenSaverState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(tokenSaverPath(env), 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { level: parseLevel((parsed as { level?: unknown }).level) }
    }
  } catch {
    // Missing, malformed, or unreadable state uses the safe default.
  }
  return { level: DEFAULT_TOKEN_SAVER_LEVEL }
}

export function save(
  stateOrLevel: TokenSaverState | TokenSaverLevel | unknown,
  env: NodeJS.ProcessEnv = process.env,
): TokenSaverState {
  const value = stateOrLevel !== null && typeof stateOrLevel === 'object' && !Array.isArray(stateOrLevel)
    ? (stateOrLevel as { level?: unknown }).level
    : stateOrLevel
  const state = { level: parseLevel(value) }
  const target = tokenSaverPath(env)
  const directory = dirname(target)
  const temporary = join(directory, `.${TOKEN_SAVER_FILE}.tmp-${process.pid}-${Date.now()}`)
  mkdirSync(directory, { recursive: true })
  try {
    writeFileSync(temporary, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, target)
  } catch (error) {
    try { unlinkSync(temporary) } catch { /* best effort cleanup */ }
    throw error
  }
  return state
}

export const loadTokenSaverState = load
export const saveTokenSaverState = save
