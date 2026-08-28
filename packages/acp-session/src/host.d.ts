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
    approval?: import('@deepseek-ai/dsh-user-approval').ApprovalService
    agent?: import('@deepseek-ai/dsh-agent').Agent
    get<T = unknown>(name: string): T | undefined
    effect(fn: () => (() => unknown) | void, label?: string): () => Promise<void> | void
    plugin(plugin: unknown, config?: unknown): { ctx: Context; dispose: () => Promise<void> | void }
    extend(value: Record<string | symbol, unknown>): Context
    inject(deps: string[], callback: (ctx: Context) => void): { dispose: () => Promise<void> | void }
    accessor(name: string, descriptor: { get: () => unknown }): void
    on(event: string, listener: (...args: unknown[]) => unknown): () => void
  }

  export class Service {
    ctx: Context
    constructor(ctx: Context, name: string)
  }

  export const FiberState: {
    UNLOADING: number
    DISPOSED: number
    FAILED: number
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

  export type TurnEndReason =
    | { kind: 'completed' }
    | { kind: 'aborted'; reason: unknown }
    | { kind: 'blocked' }
    | { kind: 'error'; error: { message: string; code: string } }
    | { kind: 'max-tokens' }
    | { kind: 'interrupted' }

  export type AgentCancelCause =
    | { readonly kind: 'user' }
    | { readonly kind: 'parent' }
    | { readonly kind: 'hook'; readonly reason: string }
    | { readonly kind: 'disposed' }

  export interface Session {
    readonly id: SessionId
    readonly header: SessionHeader
    readonly events: readonly SessionEvent[]
    append(type: string, data: unknown, opts?: { surfaceOp?: 'append'; sourceEventSeqs?: number[] }): SessionEvent
  }

  export interface SessionStore {
    prepare(id?: SessionId, options?: {
      seed?: readonly SessionEvent[]
      meta?: Partial<Pick<SessionHeader, 'cwd' | 'parentSession' | 'seedLength' | 'origin' | 'delegationDepth' | 'agentPreset'>>
    }): Session
    enter(session: Session): () => void
    announce(session: Session): void
    get(id: SessionId): Session | undefined
    flush(session: Session): Promise<boolean>
  }

  export interface SessionPreparationOptions {
    readonly release?: () => void
  }

  export class SessionPreparation {
    readonly session: Session
    static create(session: Session, options?: SessionPreparationOptions): SessionPreparation
    [Symbol.dispose](): void
  }

  export interface SessionPersistence {
    prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation>
    list(): Promise<Array<{ id: SessionId }>>
  }
}

declare module '@deepseek-ai/dsh-llm' {
  export type ToolCallId = string & { readonly __brand: 'ToolCallId' }
  export function ToolCallId(id: string): ToolCallId

  export type StreamChunk =
    | { type: 'block-start'; index: number; blockType: string }
    | { type: 'text-delta'; index: number; text: string }
    | { type: 'reasoning-delta'; index: number; text: string }
    | { type: 'block-end'; index: number; block: unknown }
    | { type: 'usage'; usage: unknown }
    | { type: 'finish'; reason: string }

  export interface UserMessage {
    readonly id: string
    readonly role: 'user'
    readonly content: Array<{ type: string; text?: string; [key: string]: unknown }>
    readonly source: { kind: string; [key: string]: unknown }
  }

  export interface AssistantMessage {
    readonly id: string
    readonly role: 'assistant'
    readonly content: Array<{ type: string; text?: string; [key: string]: unknown }>
    readonly source: { kind: 'model'; provider: string; model: string }
  }

  export function createUserMessage(input: {
    content: unknown[]
    source: { kind: string; [key: string]: unknown }
  }): import('@deepseek-ai/dsh-llm').UserMessage

  export function createAssistantMessage(input: {
    content: unknown[]
    source: { provider: string; model: string }
  }): import('@deepseek-ai/dsh-llm').AssistantMessage

  export function createToolResultMessage(input: {
    callId: ToolCallId
    content: unknown[]
    isError: boolean
  }): import('@deepseek-ai/dsh-llm').UserMessage
}

declare module '@deepseek-ai/dsh-agent' {
  import type { Context } from '@deepseek-ai/cordis'
  import type { Session, SessionId, AgentCancelCause } from '@deepseek-ai/dsh-session'
  import type { UserMessage } from '@deepseek-ai/dsh-llm'

  export type InboxTarget = 'next-turn' | 'next-step'
  export type AgentStatus = 'idle' | 'running'
  export type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'

  export interface AgentOptions {
    provider?: string
    model?: string
    maxTokens?: number
  }

  export interface CancelOptions {
    keepInbox?: boolean
  }

  export interface InboxNotifications {
    inserted(message: UserMessage): void
    discarded(message: UserMessage): void
    claimed(message: UserMessage, turn: number): void
  }

  export class Inbox {
    constructor(session: Session, notifications: InboxNotifications)
    get nextTurn(): readonly UserMessage[]
    get nextStep(): readonly UserMessage[]
    get hasPending(): boolean
    splice(target: InboxTarget, start: number, removedCount: number, inserted: UserMessage[]): void
    clear(): void
    claim(target: InboxTarget, turn: number): UserMessage[]
  }

  export interface Agent {
    readonly id: SessionId
    readonly options: AgentOptions
    readonly session: Session
    readonly inbox: Inbox
    readonly status: AgentStatus
    readonly ctx: Context
    cancel(cause: AgentCancelCause, options?: CancelOptions): void
    whenIdle(): Promise<void>
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
    send(message: UserMessage, target: InboxTarget, wakeup: boolean): void
    followup(message: UserMessage): void
    steer(message: UserMessage): void
    inject(message: UserMessage): void
  }

  export interface AgentSetupCommit {
    commit(): void
  }

  export type AgentSetup = (
    agentCtx: Context,
  ) => AgentSetupCommit | Promise<AgentSetupCommit | void> | void

  export interface CreateAgentOptions {
    readonly sessionId: SessionId
    readonly meta?: {
      readonly cwd?: string
      readonly parentSession?: SessionId
      readonly seedLength?: number
      readonly origin?: 'subagent'
      readonly delegationDepth?: number
      readonly agentPreset?: string
    }
    readonly seed?: readonly unknown[]
    readonly agentOptions?: AgentOptions
    readonly signal?: AbortSignal
    readonly setup?: AgentSetup
  }

  export interface ResumeAgentOptions {
    readonly resumeSessionId: SessionId
    readonly agentOptions?: AgentOptions
    readonly signal?: AbortSignal
    readonly setup?: AgentSetup
  }

  export interface AgentHandle {
    agent: Agent
    dispose(): Promise<void>
  }

  export interface AgentFactory {
    createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle>
    resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle>
  }

  export interface AgentRegistry {
    setFactory(factory: AgentFactory): () => void
    create(options: CreateAgentOptions): Promise<AgentHandle>
    resume(options: ResumeAgentOptions): Promise<AgentHandle>
    enter(agent: Agent, owner: Agent | undefined): () => void
    announce(agent: Agent): void
    get(id: SessionId): Agent | undefined
    withInitiator<T>(agent: Agent, operation: () => T): T
  }

  export function emitAgentEvent(
    ctx: Context,
    agent: Agent,
    name: string,
    payload: Record<string, unknown>,
  ): void

  export function agentEvents(ctx: Context, agent: Agent): {
    emit(name: string, payload: Record<string, unknown>): void
  }
}

declare module '@deepseek-ai/dsh-scope' {
  import type { Context } from '@deepseek-ai/cordis'

  export interface Scope {
    ctx: Context
    rawDispose: () => Promise<void> | void
    dispose(): Promise<void>
  }

  export function createScope(ctx: Context, key: object, options?: { parent?: object }): Scope
}

declare module '@deepseek-ai/dsh-user-approval' {
  import type { Agent } from '@deepseek-ai/dsh-agent'

  export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

  export interface ApprovalRequest {
    readonly agent: Agent
    readonly toolName: string
    readonly callId?: string
    readonly reason?: string
    readonly signal?: AbortSignal
  }

  export class ApprovalService {
    request(req: ApprovalRequest): Promise<ApprovalOutcome>
  }
}
