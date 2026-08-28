/** Plugin configuration (cordis.patch.yml `config`). */
export interface Config {
  /**
   * Already-running Leyline daemon. Default `http://127.0.0.1:6868`.
   * This plugin never starts or embeds the daemon.
   */
  baseUrl?: string
  /**
   * Opt-in `POST /v1/materialize` of `<worktree>/.leyline/LESSONS.md`.
   * Default OFF — it writes a file into the operator's git workspace.
   */
  materialize?: boolean
  /** Context-pack memory budget. Default 4. */
  maxMemories?: number
  /** Context-pack token budget. Default 1200. */
  maxTokens?: number
  /** Leyline workspace shard. Default `ws_local`. */
  workspaceId?: string
  /** HTTP timeout in milliseconds. Default 4000. */
  timeoutMs?: number
}

export interface ResolvedConfig {
  baseUrl: string
  materialize: boolean
  maxMemories: number
  maxTokens: number
  workspaceId: string
  timeoutMs: number
}

export const DEFAULT_BASE_URL = 'http://127.0.0.1:6868'
export const DEFAULT_WORKSPACE_ID = 'ws_local'
export const SOURCE_CLIENT_ID = 'lumine-dsh'
export const CLIENT_VERSION = '0.1.0'

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const maxMemories = Number.isFinite(config.maxMemories) ? Math.max(1, Math.trunc(config.maxMemories as number)) : 4
  const maxTokens = Number.isFinite(config.maxTokens) ? Math.max(1, Math.trunc(config.maxTokens as number)) : 1200
  const timeoutMs = Number.isFinite(config.timeoutMs) ? Math.max(250, Math.trunc(config.timeoutMs as number)) : 4000
  const workspaceId = config.workspaceId?.trim() || DEFAULT_WORKSPACE_ID
  return {
    baseUrl,
    materialize: config.materialize === true,
    maxMemories,
    maxTokens,
    workspaceId,
    timeoutMs,
  }
}
