import type { TokenSaverLevel } from './store.ts'

export interface SubagentRouteOptions {
  model?: string
  effort?: string
  [key: string]: unknown
}

/**
 * Route only the options used at a new subagent spawn. Existing sessions are
 * intentionally untouched; the caller owns the spawn-time boundary.
 */
export function routeSubagent(
  level: TokenSaverLevel,
  requested?: SubagentRouteOptions,
): SubagentRouteOptions {
  const options = requested ?? {}
  if (level === 'off' || level === 'light') return options

  // Keep an explicitly selected Grok 4.6 family model on Grok while lowering
  // effort. Other model selection is likewise preserved: this dial controls
  // spend at the spawn boundary without silently changing provider identity.
  return { ...options, effort: 'low' }
}
