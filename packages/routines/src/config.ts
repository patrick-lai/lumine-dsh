/** Plugin configuration (cordis.patch.yml `config`). */
export interface Config {
  /**
   * Agent preset used when a routine does not name its own.
   * Deployment default is `grok-build`.
   */
  defaultPreset?: string
  /** Shared workspace checkout used when a routine does not name `workspaceCwd`. */
  defaultWorkspaceCwd?: string
  /** Cordis timer period. Default 30s (`ctx.interval`). */
  tickMs?: number
  /**
   * An in-flight run older than this is treated as crashed and reclaimed.
   * Default 6 hours.
   */
  staleAfterMs?: number
}

export interface ResolvedConfig {
  defaultPreset: string
  defaultWorkspaceCwd?: string
  tickMs: number
  staleAfterMs: number
}

export const DEFAULT_TICK_MS = 30_000
export const DEFAULT_STALE_AFTER_MS = 21_600_000
export const MAX_DELIVERY_FAILURES = 3

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const tickMs = Number.isFinite(config.tickMs) && (config.tickMs ?? 0) > 0
    ? Math.floor(config.tickMs as number)
    : DEFAULT_TICK_MS
  const staleAfterMs = Number.isFinite(config.staleAfterMs) && (config.staleAfterMs ?? 0) > 0
    ? Math.floor(config.staleAfterMs as number)
    : DEFAULT_STALE_AFTER_MS
  const defaultWorkspaceCwd = config.defaultWorkspaceCwd?.trim()
  return {
    defaultPreset: config.defaultPreset?.trim() || 'grok-build',
    ...defaultWorkspaceCwd ? { defaultWorkspaceCwd } : {},
    tickMs,
    staleAfterMs,
  }
}
