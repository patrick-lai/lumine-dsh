/** Plugin configuration (cordis.patch.yml `config`). */
export interface Config {
  /**
   * Agent preset used when a routine does not name its own.
   * Deployment default is `grok-build`.
   */
  defaultPreset?: string
  /** Shared workspace checkout used when a routine does not name `workspaceCwd`. */
  defaultWorkspaceCwd?: string
  /** In-process timer period. Default 15s. */
  tickMs?: number
  /**
   * An in-flight grind/run older than this is treated as crashed and no
   * longer blocks. Default 6 hours. `0` means never stale.
   */
  staleAfterMs?: number
  /** Hidden continue ceiling for grind v1. Default 8. */
  grindMaxTurns?: number
}

export interface ResolvedConfig {
  defaultPreset: string
  defaultWorkspaceCwd?: string
  tickMs: number
  staleAfterMs: number
  grindMaxTurns: number
}

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const tickMs = Number.isFinite(config.tickMs) && (config.tickMs ?? 0) > 0
    ? Math.floor(config.tickMs as number)
    : 15_000
  const staleAfterMs = config.staleAfterMs === 0
    ? 0
    : Number.isFinite(config.staleAfterMs) && (config.staleAfterMs ?? 0) > 0
      ? Math.floor(config.staleAfterMs as number)
      : 21_600_000
  const grindMaxTurns = Number.isSafeInteger(config.grindMaxTurns) && (config.grindMaxTurns ?? 0) > 0
    ? Math.floor(config.grindMaxTurns as number)
    : 8
  const defaultWorkspaceCwd = config.defaultWorkspaceCwd?.trim()
  return {
    defaultPreset: config.defaultPreset?.trim() || 'grok-build',
    ...defaultWorkspaceCwd ? { defaultWorkspaceCwd } : {},
    tickMs,
    staleAfterMs,
    grindMaxTurns,
  }
}
