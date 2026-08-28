import type { ProviderId } from './providers.ts'
import { DEFAULT_KEEP_IDLE, detectAtlassian, resolveHome } from './worktree-pool.ts'

/** How ACP permission prompts are answered. */
export type PermissionMode = 'yolo' | 'ask'

/** Per-provider launch overrides. Paths may be absolute or PATH names. */
export interface ProviderOverride {
  /** Executable to spawn. Defaults are PATH names (`cursor-agent`, `grok`, `npx`). */
  command?: string
  /** Arguments after the command. */
  args?: string[]
  /** Official product binary (`claude`, `codex`) used for login + adapter env. */
  productCommand?: string
  /** ACP authenticate method id when the child advertises one. */
  authMethod?: string
  /** Extra child env. Never used to scrape tokens. */
  env?: Record<string, string>
  /** Allow forwarding OPENAI_API_KEY / CODEX_API_KEY to Codex. Default false. */
  allowApiKey?: boolean
}

/** Raphael-style pooled git worktrees for ACP child cwd. */
export type WorktreeMode = 'auto' | 'always' | 'never'

export interface WorktreeConfig {
  /**
   * `auto` (default) pools a tree when the picker cwd is a git repo.
   * `never` uses the picker path. `always` fails the session if cwd is not git.
   */
  mode?: WorktreeMode
  /** Override home. Default `os.homedir()`. */
  home?: string
  /**
   * Nest the pool under `~/atlassian/.lumine/worktrees`.
   * Default: true when `~/atlassian` exists.
   */
  atlassian?: boolean
  /**
   * Keep this many idle trees before auto-removing a claimable one.
   * Default 10 (Raphael operator policy).
   */
  keepIdle?: number
}

export interface ResolvedWorktreeConfig {
  mode: WorktreeMode
  home: string
  atlassian: boolean
  keepIdle: number
}

/** Plugin configuration (cordis.patch.yml `config`). */
export interface Config {
  /**
   * Used when a session names no preset and `agentOptions.provider` is empty.
   * Default `claude`.
   */
  defaultProvider?: ProviderId
  /**
   * `yolo` (default) always-approves tool permission prompts.
   * `ask` routes through `dsh-user-approval` and still allows if no answerer.
   */
  permission?: PermissionMode
  /** Per-provider command / auth overrides. */
  providers?: Partial<Record<ProviderId, ProviderOverride>>
  /** Isolated git worktrees for each session. Raphael-shaped pool. */
  worktrees?: WorktreeConfig
}

export interface ResolvedConfig {
  defaultProvider: ProviderId
  permission: PermissionMode
  providers: Partial<Record<ProviderId, ProviderOverride>>
  /** Always set by `resolveConfig`. Optional so tests can construct a partial agent config. */
  worktrees?: ResolvedWorktreeConfig
}

export function resolveWorktrees(config: WorktreeConfig = {}): ResolvedWorktreeConfig {
  const home = resolveHome(config.home)
  const keepIdle = config.keepIdle ?? DEFAULT_KEEP_IDLE
  const mode = config.mode === 'always' || config.mode === 'never' ? config.mode : 'auto'
  return {
    mode,
    home,
    atlassian: config.atlassian ?? detectAtlassian(home),
    keepIdle: Number.isFinite(keepIdle) ? Math.max(0, Math.trunc(keepIdle)) : DEFAULT_KEEP_IDLE,
  }
}

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const permission = config.permission === 'ask' ? 'ask' : 'yolo'
  return {
    defaultProvider: config.defaultProvider ?? 'claude',
    permission,
    providers: config.providers ?? {},
    worktrees: resolveWorktrees(config.worktrees),
  }
}
