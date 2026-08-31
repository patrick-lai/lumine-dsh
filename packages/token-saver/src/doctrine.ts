import type { TokenSaverLevel } from './store.ts'

const LIGHT = 'Keep evidence concise: reuse existing facts and avoid redundant prose or tool calls.'
const BALANCED = 'GRAPH FIRST: decompose work into a small dependency graph; fan out ready independent leaves, never both (answer or fan out), and verify here.'
const AGGRESSIVE = `${BALANCED} SUB-BREAK: split oversized leaves and stop speculative branches early.`

export function tokenOffloadSection(level: TokenSaverLevel): string {
  if (level === 'off') return ''
  if (level === 'light') return LIGHT
  return level === 'aggressive' ? AGGRESSIVE : BALANCED
}

export function doctrineFor(level: TokenSaverLevel): string {
  return tokenOffloadSection(level)
}
