/**
 * Ambient host types. DeepSeek Harness provides these packages at runtime.
 * Declared here so this plugin builds without a sibling DSH checkout.
 */

declare module '@deepseek-ai/cordis' {
  export class Context {
    fiber: { assertActive(): void; state: number; dispose(): Promise<void> | void }
    logger: { warn(...args: unknown[]): void; info(...args: unknown[]): void; error(...args: unknown[]): void }
    agents: import('@deepseek-ai/dsh-agent').AgentRegistry
    sessions?: import('@deepseek-ai/dsh-session').SessionStore
    tools?: { register(tool: unknown): unknown }
    routines?: unknown
    interval(callback: () => unknown, delay: number): () => void
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
    prepare(id?: SessionId, options?: {
      seed?: readonly SessionEvent[]
      meta?: Partial<Pick<SessionHeader, 'cwd' | 'agentPreset'>>
    }): Session
    enter(session: Session): () => void
    announce(session: Session): void
    get(id: SessionId): Session | undefined
  }
}

declare module '@deepseek-ai/dsh-llm' {
  export interface UserMessage {
    readonly id: string
    readonly role: 'user'
    readonly content: Array<{ type: string; text?: string; [key: string]: unknown }>
    readonly source: { kind: string; [key: string]: unknown }
  }

  export function createUserMessage(input: {
    content: unknown[]
    source: { kind: string; [key: string]: unknown }
  }): import('@deepseek-ai/dsh-llm').UserMessage
}

declare module '@deepseek-ai/dsh-agent' {
  import type { Context } from '@deepseek-ai/cordis'
  import type { Session, SessionId } from '@deepseek-ai/dsh-session'
  import type { UserMessage } from '@deepseek-ai/dsh-llm'

  export type InboxTarget = 'next-turn' | 'next-step'
  export type AgentStatus = 'idle' | 'running'

  export interface Agent {
    readonly id: SessionId
    readonly session: Session
    readonly status: AgentStatus
    readonly ctx: Context
    whenIdle(): Promise<void>
    send(message: UserMessage, target: InboxTarget, wakeup: boolean): void
    followup(message: UserMessage): void
  }

  export interface CreateAgentOptions {
    readonly sessionId?: SessionId
    readonly meta?: {
      readonly cwd?: string
      readonly agentPreset?: string
    }
    readonly signal?: AbortSignal
  }

  export interface AgentHandle {
    agent: Agent
    dispose(): Promise<void>
  }

  export interface AgentRegistry {
    create(options: CreateAgentOptions): Promise<AgentHandle>
    get(id: SessionId): Agent | undefined
  }
}

declare module '@deepseek-ai/dsh-tools' {
  export interface ToolOutputDefinition {
    readonly schema: unknown
    render(args: unknown, value: unknown): Array<{ type: string; text?: string }>
    presentationMeta?(args: unknown, value: unknown): unknown
  }

  export interface ToolDefinition {
    readonly name: string
    readonly description: string
    readonly parameters: unknown
    readonly output: ToolOutputDefinition
    execute(args: unknown, exec?: unknown): Promise<unknown>
  }

  export function defineTool(options: {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: {
      schema: unknown
      render(args: unknown, value: unknown): Array<{ type: string; text?: string }>
      presentationMeta?(args: unknown, value: unknown): unknown
    }
    execute(args: unknown, exec?: unknown): Promise<unknown> | unknown
  }): ToolDefinition
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  import type { Context } from '@deepseek-ai/cordis'

  export class TypertRemoteService {
    ctx: Context
    constructor(ctx: Context, name: string)
  }

  export function Remote(name?: string): MethodDecorator
}

declare module '@deepseek-ai/dsh-storage-domain' {
  export function defineDomain(spec: unknown): unknown
  export function domainTable(schema: unknown): unknown
}
