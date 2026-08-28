/**
 * Ambient host types. DeepSeek Harness provides these packages at runtime.
 * Declared here so this plugin builds without a sibling DSH checkout.
 */

declare module '@deepseek-ai/cordis' {
  export class Context {
    fiber: { assertActive(): void; state: number; dispose(): Promise<void> | void }
    logger: { warn(...args: unknown[]): void; info(...args: unknown[]): void; error(...args: unknown[]): void }
    agents: import('@deepseek-ai/dsh-agent').AgentRegistry
    sessions: import('@deepseek-ai/dsh-session').SessionStore
    systemPrompt?: {
      section(entry: { name: string; order: number; text: string | (() => string) }): () => void
    }
    workspaceRegistry?: {
      delete(id: string): Promise<boolean>
      get(id: string): { id: string; path: string } | undefined
    }
    get<T = unknown>(name: string): T | undefined
    effect(fn: () => (() => unknown) | void, label?: string): () => Promise<void> | void
    plugin(plugin: unknown, config?: unknown): { ctx: Context; dispose: () => Promise<void> | void }
    inject(deps: string[], callback: (ctx: Context) => void): { dispose: () => Promise<void> | void }
    on(event: string, listener: (...args: unknown[]) => unknown): () => void
  }

  export class Service {
    ctx: Context
    constructor(ctx: Context, name: string)
  }

  /**
   * Const enum (PENDING=0, LOADING=1, ACTIVE=2, FAILED=3, DISPOSED=4, UNLOADING=5).
   * Erased from the published JS — do not value-import `FiberState`.
   */
  export const enum FiberState {
    PENDING = 0,
    LOADING = 1,
    ACTIVE = 2,
    FAILED = 3,
    DISPOSED = 4,
    UNLOADING = 5,
  }
}

declare module '@deepseek-ai/dsh-session' {
  export type SessionId = string & { readonly __brand: 'SessionId' }
  export function SessionId(id: string): SessionId

  export interface SessionHeader {
    readonly version: number
    readonly id: SessionId
    readonly createdAt: number
    readonly cwd?: string
    readonly parentSession?: SessionId
    readonly seedLength?: number
    readonly origin?: 'subagent'
    readonly delegationDepth?: number
    readonly agentPreset?: string
  }

  export interface SessionEvent<T extends string = string> {
    readonly type: T
    readonly seq: number
    readonly time: number
    readonly data: unknown
  }

  export interface Session {
    readonly id: SessionId
    readonly header: SessionHeader
    readonly events: readonly SessionEvent[]
    append(type: string, data: unknown, opts?: { surfaceOp?: 'append'; sourceEventSeqs?: number[] }): SessionEvent
  }

  export interface SessionStore {
    get(id: SessionId): Session | undefined
    list?(): Session[]
    enter(session: Session): () => void
    announce(session: Session): void
  }
}

declare module '@deepseek-ai/dsh-agent' {
  import type { Context } from '@deepseek-ai/cordis'
  import type { Session, SessionId } from '@deepseek-ai/dsh-session'

  export type AgentStatus = 'idle' | 'running'
  export type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'

  export interface Agent {
    readonly id: SessionId
    readonly session: Session
    readonly status: AgentStatus
    readonly ctx: Context
  }

  export interface AgentRegistry {
    get(id: SessionId): Agent | undefined
    list(): Agent[]
  }

  export function emitAgentEvent(
    ctx: Context,
    agent: Agent,
    name: string,
    payload: Record<string, unknown>,
  ): void
}

declare module '@deepseek-ai/dsh-scope' {
  export interface Scope {
    dispose(): Promise<void>
  }
}
