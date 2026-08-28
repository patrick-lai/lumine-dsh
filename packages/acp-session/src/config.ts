import type { ProviderId } from './providers.ts'

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
}

export interface ResolvedConfig {
  defaultProvider: ProviderId
  permission: PermissionMode
  providers: Partial<Record<ProviderId, ProviderOverride>>
}

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const permission = config.permission === 'ask' ? 'ask' : 'yolo'
  return {
    defaultProvider: config.defaultProvider ?? 'claude',
    permission,
    providers: config.providers ?? {},
  }
}
