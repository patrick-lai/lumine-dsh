import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import type { ProviderOverride } from './config.ts'

/** The four official products this factory can own a session as. */
export const PROVIDER_IDS = ['claude', 'codex', 'cursor', 'grok'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

/** Web picker preset directory names → provider. */
export const PRESET_TO_PROVIDER: Readonly<Record<string, ProviderId>> = {
  'claude-code': 'claude',
  claude: 'claude',
  codex: 'codex',
  cursor: 'cursor',
  'grok-build': 'grok',
  grok: 'grok',
}

export const PROVIDER_LABEL: Readonly<Record<ProviderId, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  grok: 'Grok Build',
}

export const PROVIDER_LOGIN: Readonly<Record<ProviderId, string>> = {
  claude: 'claude (Claude Code Pro/Max login)',
  codex: 'codex login (ChatGPT)',
  cursor: 'cursor-agent login / agent login',
  grok: 'grok login (SuperGrok / X Premium+)',
}

export interface ResolvedLaunch {
  provider: ProviderId
  command: string
  args: string[]
  env: Record<string, string>
  /** Env names stripped so subscription login wins over vendor API keys. */
  unset: string[]
  authMethod?: string
  /** Human-facing product binary the user must have installed and logged into. */
  productCommand: string
}

export class MissingCliError extends Error {
  readonly code = 'CLI_MISSING'
  constructor(readonly provider: ProviderId, readonly lookedFor: string[]) {
    super(missingCliMessage(provider, lookedFor))
    this.name = 'MissingCliError'
  }
}

export function missingCliMessage(provider: ProviderId, lookedFor: string[]): string {
  const label = PROVIDER_LABEL[provider]
  const login = PROVIDER_LOGIN[provider]
  const looked = lookedFor.join(', ')
  return [
    `${label} CLI was not found.`,
    `Install ${label} and log in with \`${login}\`, then retry.`,
    `Looked for: ${looked}.`,
    'This plugin never scrapes tokens or hits unofficial backends — usage bills your existing subscription.',
  ].join(' ')
}

export function isProviderId(value: string | undefined): value is ProviderId {
  return value !== undefined && (PROVIDER_IDS as readonly string[]).includes(value)
}

/** Map a DSH preset id, agentOptions.provider, or alias onto a provider. */
export function resolveProviderId(
  input: { preset?: string; provider?: string; fallback: ProviderId },
): ProviderId {
  const fromProvider = input.provider?.trim().toLowerCase()
  if (fromProvider && isProviderId(fromProvider)) return fromProvider
  if (fromProvider && PRESET_TO_PROVIDER[fromProvider]) return PRESET_TO_PROVIDER[fromProvider]
  const fromPreset = input.preset?.trim().toLowerCase()
  if (fromPreset && PRESET_TO_PROVIDER[fromPreset]) return PRESET_TO_PROVIDER[fromPreset]
  if (fromPreset && isProviderId(fromPreset)) return fromPreset
  return input.fallback
}

export interface ResolveLaunchOptions {
  override?: ProviderOverride
  env?: NodeJS.ProcessEnv
  pathDirs?: string[]
  which?: (command: string, pathDirs: string[]) => string | undefined
}

const DEFAULT_AUTH: Readonly<Record<ProviderId, string | undefined>> = {
  claude: undefined,
  codex: 'chatgpt',
  cursor: 'cursor_login',
  grok: undefined,
}

function extraPathDirs(env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME ?? homedir()
  return [
    join(home, '.local', 'bin'),
    join(home, '.grok', 'bin'),
  ]
}

function pathEntries(env: NodeJS.ProcessEnv, extra: string[]): string[] {
  const fromEnv = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  const seen = new Set<string>()
  const out: string[] = []
  for (const dir of [...extra, ...fromEnv]) {
    if (seen.has(dir)) continue
    seen.add(dir)
    out.push(dir)
  }
  return out
}

const WIN_EXTS = ['.exe', '.cmd', '.bat', '.COM']

export function whichOnPath(command: string, pathDirs: string[]): string | undefined {
  if (command.includes('/') || command.includes('\\') || isAbsolute(command)) {
    return existsSync(command) ? command : undefined
  }
  const names = process.platform === 'win32' && !command.includes('.')
    ? [command, ...WIN_EXTS.map(ext => `${command}${ext}`)]
    : [command]
  for (const dir of pathDirs) {
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

function requireFound(
  provider: ProviderId,
  command: string,
  pathDirs: string[],
  which: (command: string, pathDirs: string[]) => string | undefined,
  lookedFor: string[],
): string {
  const found = which(command, pathDirs)
  if (found === undefined) throw new MissingCliError(provider, lookedFor)
  return found
}

/**
 * Resolve the official launch command for one provider.
 *
 * Cursor defaults to `cursor-agent acp`, not `agent acp`: on Patrick's Mac
 * `agent` is Grok Build. Claude/Codex use the published ACP adapters pointed
 * at the user's already-logged-in official CLIs.
 */
export function resolveLaunch(provider: ProviderId, options: ResolveLaunchOptions = {}): ResolvedLaunch {
  const env = options.env ?? process.env
  const extras = options.pathDirs ?? extraPathDirs(env)
  const pathDirs = pathEntries(env, extras)
  const which = options.which ?? whichOnPath
  const override = options.override ?? {}

  if (provider === 'cursor') {
    const commandName = override.command ?? 'cursor-agent'
    const lookedFor = [commandName, join(homedir(), '.local', 'bin', 'cursor-agent')]
    const command = requireFound(provider, commandName, pathDirs, which, lookedFor)
    return {
      provider,
      command,
      args: override.args ?? ['acp'],
      env: { ...override.env },
      unset: [],
      authMethod: override.authMethod ?? DEFAULT_AUTH.cursor,
      productCommand: override.productCommand ?? 'cursor-agent',
    }
  }

  if (provider === 'grok') {
    const commandName = override.command ?? 'grok'
    const lookedFor = [commandName, join(homedir(), '.grok', 'bin', 'grok')]
    const command = requireFound(provider, commandName, pathDirs, which, lookedFor)
    return {
      provider,
      command,
      args: override.args ?? ['agent', '--always-approve', 'stdio'],
      env: { ...override.env },
      unset: [],
      authMethod: override.authMethod,
      productCommand: override.productCommand ?? 'grok',
    }
  }

  if (provider === 'claude') {
    const productName = override.productCommand ?? 'claude'
    const product = requireFound(provider, productName, pathDirs, which, [productName])
    const npx = override.command ?? 'npx'
    const command = requireFound(provider, npx, pathDirs, which, [npx, productName])
    return {
      provider,
      command,
      args: override.args ?? ['-y', '@agentclientprotocol/claude-agent-acp'],
      env: {
        CLAUDE_CODE_EXECUTABLE: product,
        ...override.env,
      },
      unset: override.allowApiKey ? [] : ['ANTHROPIC_API_KEY'],
      authMethod: override.authMethod,
      productCommand: productName,
    }
  }

  const productName = override.productCommand ?? 'codex'
  const product = requireFound(provider, productName, pathDirs, which, [productName])
  const npx = override.command ?? 'npx'
  const command = requireFound(provider, npx, pathDirs, which, [npx, productName])
  return {
    provider,
    command,
    args: override.args ?? ['-y', '@agentclientprotocol/codex-acp'],
    env: {
      CODEX_PATH: product,
      ...override.env,
    },
    unset: override.allowApiKey ? [] : ['OPENAI_API_KEY', 'CODEX_API_KEY'],
    authMethod: override.authMethod ?? DEFAULT_AUTH.codex,
    productCommand: productName,
  }
}

export function childEnvironment(launch: ResolvedLaunch, parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parent }
  for (const key of launch.unset) delete env[key]
  // Never inject vendor API keys we do not already inherit.
  Object.assign(env, launch.env)
  return env
}
