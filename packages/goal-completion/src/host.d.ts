/**
 * Ambient host types. DeepSeek Harness provides these packages at runtime.
 * Declared here so this plugin builds without a sibling DSH checkout.
 */

declare module '@deepseek-ai/cordis' {
  export class Context {
    fiber: { assertActive(): void; state: number; dispose(): Promise<void> | void; children?: Array<{ name?: string }> }
    logger: { warn(...args: unknown[]): void; info(...args: unknown[]): void; error(...args: unknown[]): void }
    agents: import('@deepseek-ai/dsh-agent').AgentRegistry
    sessions: import('@deepseek-ai/dsh-session').SessionStore
    goals?: GoalHost
    tools?: ToolHost
    subagents?: {
      run?(request: Record<string, unknown>): Promise<{ text?: string; output?: string }>
      spawn?(request: Record<string, unknown>): Promise<{ text?: string; output?: string }>
    }
    registry?: {
      keys?(): Iterable<unknown>
      forEach?(callback: (value: unknown, key: unknown) => void): void
    }
    runtime?: { name?: string; parent?: { name?: string } }
    agent?: import('@deepseek-ai/dsh-agent').Agent
    get<T = unknown>(name: string): T | undefined
    effect(fn: () => (() => unknown) | void, label?: string): () => Promise<void> | void
    plugin(plugin: unknown, config?: unknown): { ctx: Context; dispose: () => Promise<void> | void }
    extend(value: Record<string | symbol, unknown>): Context
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

interface GoalRefLike {
  readonly id: string
  readonly revision: number
}

interface GoalViewLike extends GoalRefLike {
  readonly objective: string
  readonly phase: 'active' | 'paused' | 'blocked' | 'complete'
  readonly activation?: 'armed' | 'disarmed'
  readonly blockedReason?: { code: string; message: string }
}

interface GoalHost {
  get(agent: import('@deepseek-ai/dsh-agent').Agent): GoalViewLike | undefined
  complete(agent: import('@deepseek-ai/dsh-agent').Agent, ref: GoalRefLike): GoalViewLike
  block(
    agent: import('@deepseek-ai/dsh-agent').Agent,
    ref: GoalRefLike,
    reason: { code: string; message: string },
  ): GoalViewLike
}

interface ToolDefinition {
  name?: string
  execute?: (args: Record<string, unknown>, exec: { agent?: import('@deepseek-ai/dsh-agent').Agent }) => unknown
  [key: string]: unknown
}

interface ToolHost {
  register(tool: ToolDefinition): unknown
  get?(name: string): ToolDefinition | undefined
  lookup?(name: string): ToolDefinition | undefined
}

declare module '@deepseek-ai/dsh-session' {
  export type SessionId = string & { readonly __brand: 'SessionId' }
  export function SessionId(id: string): SessionId

  export interface SessionHeader {
    readonly version?: number
    readonly id?: SessionId
    readonly createdAt?: number
    readonly cwd?: string
    readonly parentSession?: SessionId
    readonly seedLength?: number
    readonly origin?: 'subagent'
    readonly delegationDepth?: number
    readonly agentPreset?: string
  }

  export interface SessionEvent<T extends string = string> {
    readonly type: T
    readonly seq?: number
    readonly time?: number
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
    flush(session: Session): Promise<boolean>
  }
}

declare module '@deepseek-ai/dsh-llm' {
  export interface UserMessage {
    readonly id: string
    readonly role: 'user'
    readonly content: Array<{ type: string; text?: string; [key: string]: unknown }>
    readonly source: { kind: string; [key: string]: unknown }
  }
}

declare module '@deepseek-ai/dsh-agent' {
  import type { Context } from '@deepseek-ai/cordis'
  import type { Session, SessionId } from '@deepseek-ai/dsh-session'
  import type { UserMessage } from '@deepseek-ai/dsh-llm'

  export type AgentStatus = 'idle' | 'running'

  export interface Agent {
    readonly id: SessionId
    readonly options: { provider?: string; model?: string }
    readonly session: Session
    readonly status: AgentStatus
    readonly ctx: Context
    followup(message: UserMessage): void
    inject(message: UserMessage): void
    send?(message: UserMessage, target: string, wakeup: boolean): void
  }

  export interface AgentRegistry {
    get(id: SessionId): Agent | undefined
    list?(): Iterable<Agent>
  }
}

declare module '@deepseek-ai/dsh-goal' {
  export type GoalId = string
  export interface GoalRef {
    readonly id: GoalId
    readonly revision: number
  }
}

declare module '@deepseek-ai/dsh-tools' {
  export interface GenericCallView {
    card?: string
    title?: string
    kind?: string
  }
}
