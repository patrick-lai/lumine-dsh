import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { doctrineFor, tokenOffloadSection } from './doctrine.ts'
import { routeSubagent, type SubagentRouteOptions } from './routing.ts'
import { load, parseLevel, save, type TokenSaverLevel, type TokenSaverState } from './store.ts'

export const name = 'lumine-token-saver'
export const inject = ['systemPrompt', 'commands']
export const TOKEN_SAVER_RPC_NAMESPACE = 'tokenSaver'
const ROUTED_START = Symbol('lumine-token-saver-routed-start')

interface SubagentsLike {
  start?: (...args: unknown[]) => unknown
  [ROUTED_START]?: boolean
}

interface TokenSaverServiceOptions {
  env?: NodeJS.ProcessEnv
  level?: TokenSaverLevel
  onChange?: (state: TokenSaverState) => void
}

export class TokenSaverService extends TypertRemoteService {
  static inject: string[] = []
  private readonly env?: NodeJS.ProcessEnv
  private readonly onChange?: (state: TokenSaverState) => void
  private state: TokenSaverState

  constructor(ctx: Context, options: TokenSaverServiceOptions = {}) {
    super(ctx, 'tokenSaver', { namespace: TOKEN_SAVER_RPC_NAMESPACE })
    this.env = options.env
    this.onChange = options.onChange
    this.state = { level: options.level ?? load(this.env).level }
  }

  get(): TokenSaverState {
    return this.state
  }

  set(level: TokenSaverLevel): TokenSaverState {
    this.state = save(parseLevel(level), this.env)
    this.onChange?.(this.state)
    return this.state
  }
}

// Node 22 cannot parse decorator syntax in emitted JavaScript. Invoke the
// published TC39 decorator initializer explicitly, as routines does.
function installRemoteMarkers(ctor: { prototype: object }): void {
  const decorate = Remote as unknown as (
    method: (...args: never[]) => unknown,
    context: {
      kind: string
      private: boolean
      static: boolean
      name: string
      addInitializer(initializer: (this: object) => void): void
    },
  ) => void
  for (const methodName of ['get', 'set']) {
    const method = (ctor.prototype as Record<string, unknown>)[methodName]
    if (typeof method !== 'function') continue
    decorate(method as (...args: never[]) => unknown, {
      kind: 'method',
      private: false,
      static: false,
      name: methodName,
      addInitializer(initializer) { initializer.call(Object.create(ctor.prototype)) },
    })
  }
}
installRemoteMarkers(TokenSaverService)

function routeStart(readLevel: () => TokenSaverLevel, service: SubagentsLike): void {
  const original = service.start
  if (typeof original !== 'function' || service[ROUTED_START]) return

  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    const level = readLevel()
    const cloned = [...args]
    const requestIndex = typeof cloned[0] === 'string' && cloned.length > 1 ? 1 : 0
    const request = cloned[requestIndex]
    if (request !== null && typeof request === 'object' && !Array.isArray(request)) {
      const record = request as Record<string, unknown>
      const nested = record.agentOptions
      if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
        cloned[requestIndex] = { ...record, agentOptions: routeSubagent(level, nested as SubagentRouteOptions) }
      } else {
        cloned[requestIndex] = { ...record, ...routeSubagent(level, record as SubagentRouteOptions) }
      }
    }
    return original.apply(this, cloned)
  }

  try {
    service.start = wrapped
    service[ROUTED_START] = true
  } catch {
    // A read-only service surface is safe to leave unwrapped.
  }
}

const TOKEN_SAVER_PROMPT_ORDER = 80

function installPrompt(ctx: Context, level: TokenSaverLevel, previous?: (() => void) | unknown): (() => void) | unknown {
  if (typeof previous === 'function') previous()
  return ctx.systemPrompt.section({
    name,
    order: TOKEN_SAVER_PROMPT_ORDER,
    text: doctrineFor(level),
  })
}

function registerTokenSaverCommand(ctx: Context, controller: { get(): TokenSaverState; set(level: TokenSaverLevel): TokenSaverState }): void {
  ctx.commands.register({
    name: 'token-saver',
    description: 'show or set the Token Saver dial (off|light|balanced|aggressive)',
    input: { hint: '[off|light|balanced|aggressive]' },
    handler: (invocation: { rawInput?: string }) => {
      const requested = invocation.rawInput?.trim().toLowerCase() ?? ''
      if (requested !== '' && requested !== 'off' && requested !== 'light' && requested !== 'balanced' && requested !== 'aggressive') {
        return {
          kind: 'error' as const,
          text: 'Usage: /token-saver [off|light|balanced|aggressive]',
        }
      }
      const next = requested === '' ? controller.get() : controller.set(requested)
      const doctrine = doctrineFor(next.level)
      return {
        kind: 'success' as const,
        text: [
          `Token Saver: ${next.level}`,
          doctrine || '(no extra doctrine at off)',
          'Commands: /token-saver, /token-saver off|light|balanced|aggressive',
        ].join('\n'),
      }
    },
  })
}

export function apply(ctx: Context): void {
  const env = process.env
  let promptDispose: (() => void) | unknown
  const controller = {
    get: (): TokenSaverState => load(env),
    set: (level: TokenSaverLevel): TokenSaverState => {
      const state = save(level, env)
      promptDispose = installPrompt(ctx, state.level, promptDispose)
      return state
    },
  }

  promptDispose = installPrompt(ctx, controller.get().level)
  registerTokenSaverCommand(ctx, controller)

  let subagents: SubagentsLike | undefined
  try {
    subagents = ctx.get<SubagentsLike>('subagents')
  } catch {
    subagents = undefined
  }
  if (subagents) routeStart(() => controller.get().level, subagents)

  if (typeof ctx.plugin === 'function') {
    ctx.plugin(TokenSaverService, {
      level: controller.get().level,
      env,
      onChange: (state) => {
        promptDispose = installPrompt(ctx, state.level, promptDispose)
      },
    })
  }
}

export { doctrineFor, tokenOffloadSection, routeSubagent, load, parseLevel, save }
export type { TokenSaverLevel, TokenSaverState } from './store.ts'
export { ensureDshPeers, DSH_PEERS } from './peers.ts'

export default { name, inject, apply }
