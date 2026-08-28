/** Plugin configuration (cordis.patch.yml `config`). */
export interface Config {
  /** Override daemon base URL. Also honors `LEYLINE_BASE_URL`. */
  baseUrl?: string
  /**
   * Opt-in `POST /v1/materialize` of `<worktree>/.leyline/LESSONS.md`.
   * Default OFF — it writes a file into the operator's git workspace.
   */
  materialize?: boolean
  materializeLessons?: boolean
  /** Context-pack memory budget. Default 4. */
  maxMemories?: number
  /** Context-pack token budget. Default 1200. */
  maxTokens?: number
  /** Leyline workspace shard. Default `ws_local`. */
  workspaceId?: string
  /** HTTP timeout in milliseconds. Default 4000. */
  timeoutMs?: number
  /** Inject compiled recall on `agent/pre-step`. Default true. */
  autoRecall?: boolean
  /** Capture a settlement event on turn-stop / dispose. Default true. */
  sessionEventCapture?: boolean
  /** Spawn `leyline serve` when no daemon answers. Default true. */
  spawnIfMissing?: boolean
  /** `source_client.client_id`. Must stay `lumine-dsh`. */
  clientId?: string
}

export interface ResolvedConfig {
  baseUrl?: string
  materialize: boolean
  maxMemories: number
  maxTokens: number
  workspaceId: string
  timeoutMs: number
  autoRecall: boolean
  sessionEventCapture: boolean
  spawnIfMissing: boolean
  clientId: string
}

export const DEFAULT_BIND = 'http://127.0.0.1:6868'
export const DEFAULT_BASE_URL = DEFAULT_BIND
export const DEFAULT_WORKSPACE_ID = 'ws_local'
export const SOURCE_CLIENT_ID = 'lumine-dsh'
export const CLIENT_VERSION = '0.1.0'
export const MEMORY_SOURCE_ID = 'leyline'
export const RECALL_CACHE_MS = 90_000
export const MIN_RECALL_QUERY_CHARS = 3

const ACP_PRESETS = new Set([
  'claude-code',
  'claude',
  'codex',
  'cursor',
  'grok-build',
  'grok',
])

export function isAcpSession(preset: string | undefined, events: ReadonlyArray<{ type: string; data: unknown }>): boolean {
  if (preset && ACP_PRESETS.has(preset)) return true
  return events.some((event) => {
    if (event.type !== 'request/context') return false
    const data = event.data as { acpSessionId?: unknown }
    return typeof data?.acpSessionId === 'string' && data.acpSessionId.length > 0
  })
}

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const maxMemories = Number.isFinite(config.maxMemories) ? Math.max(1, Math.trunc(config.maxMemories as number)) : 4
  const maxTokens = Number.isFinite(config.maxTokens) ? Math.max(1, Math.trunc(config.maxTokens as number)) : 1200
  const timeoutMs = Number.isFinite(config.timeoutMs) ? Math.max(250, Math.trunc(config.timeoutMs as number)) : 4000
  const workspaceId = config.workspaceId?.trim() || DEFAULT_WORKSPACE_ID
  const clientId = config.clientId?.trim() || SOURCE_CLIENT_ID
  return {
    baseUrl: config.baseUrl?.replace(/\/+$/, '') || undefined,
    materialize: config.materialize === true || config.materializeLessons === true,
    maxMemories,
    maxTokens,
    workspaceId,
    timeoutMs,
    autoRecall: config.autoRecall !== false,
    sessionEventCapture: config.sessionEventCapture !== false,
    spawnIfMissing: config.spawnIfMissing !== false,
    clientId,
  }
}
