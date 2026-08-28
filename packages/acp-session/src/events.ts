import { randomUUID } from 'node:crypto'
import type { ProviderId } from './providers.ts'
import { PROVIDER_LABEL } from './providers.ts'

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ReasoningBlock {
  type: 'reasoning'
  text: string
}

export interface AcpContent {
  type?: string
  text?: string
}

export interface AcpToolCall {
  toolCallId?: string
  title?: string
  kind?: string
  status?: string
  rawInput?: unknown
  rawOutput?: unknown
  content?: unknown
}

export interface AcpUpdate {
  sessionUpdate?: string
  content?: AcpContent
  toolCallId?: string
  title?: string
  kind?: string
  status?: string
  rawInput?: unknown
  rawOutput?: unknown
  entries?: unknown
  [key: string]: unknown
}

export interface Route {
  provider: ProviderId
  model: string
}

export interface LogOp {
  type: string
  data: unknown
  surface?: boolean
  sourceEventSeqs?: number[]
}

export function acpContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (content && typeof content === 'object') {
    const record = content as AcpContent
    if (typeof record.text === 'string') return record.text
  }
  return ''
}

function jsonText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function userMessageText(message: { content?: Array<{ type?: string; text?: string }> }): string {
  const blocks = message.content ?? []
  return blocks
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}

function identified(role: 'user' | 'assistant', content: unknown[], source: Record<string, unknown>) {
  return {
    id: randomUUID(),
    role,
    content,
    source,
  }
}

/** Fold one ACP `session/update` into DSH session.append operations. */
export class TurnProjector {
  private text = ''
  private reasoning = ''
  private textIndex = 0
  private reasoningIndex = 1
  private openedText = false
  private openedReasoning = false
  private readonly tools = new Map<string, { name: string; arguments: string }>()
  readonly chunkSeqs: number[] = []

  constructor(
    readonly turn: number,
    readonly step: number,
    readonly route: Route,
  ) {}

  /** Host order: persist this before Inbox.claim. */
  openTurn(): LogOp[] {
    return [{ type: 'turn/start', data: { turn: this.turn } }]
  }

  /** After claim: user message + step/start. */
  enterStep(userMessage: unknown): LogOp[] {
    return [
      { type: 'user/message', data: userMessage, surface: true },
      { type: 'step/start', data: { turn: this.turn, step: this.step } },
    ]
  }

  startTurn(userMessage: unknown): LogOp[] {
    return [...this.openTurn(), ...this.enterStep(userMessage)]
  }

  /** Close an opened turn that never entered a step (claim empty or start failed after open). */
  closeTurn(reason: 'completed' | 'aborted' | 'error', error?: { message: string; code: string }): LogOp[] {
    return [{
      type: 'turn/end',
      data: {
        turn: this.turn,
        reason: reason === 'error' && error
          ? { kind: 'error', error }
          : reason === 'aborted'
            ? { kind: 'aborted', reason: { kind: 'user' } }
            : { kind: 'completed' },
      },
    }]
  }

  /**
   * Persist the ACP route as the host `request/header` snapshot.
   *
   * Host `selectionFor().current` reads this after the first turn (or after
   * consumeSelection). Do not call this for a provider `ctx.llm.listProviders()`
   * does not serve — that is the live second-prompt `model-unavailable`.
   */
  syntheticHeader(reason: 'initial' | 'resume'): LogOp[] {
    return [
      {
        type: 'request/header',
        data: {
          header: {
            config: {
              provider: this.route.provider,
              model: this.route.model,
            },
          },
          reason,
        },
      },
    ]
  }

  /**
   * Persist the official ACP session id on a *known* DSH event.
   *
   * DSH session-persistence refuses unknown types on load (`KNOWN_SESSION_EVENT_TYPES`).
   * A custom `lumine-acp/bound` row would work in-process and then poison resume
   * after restart. `request/context` is already the synthetic per-session route
   * snapshot; we hang `acpSessionId` on it.
   */
  bind(acpSessionId: string): LogOp {
    return {
      type: 'request/context',
      data: {
        provider: this.route.provider,
        model: this.route.model,
        acpSessionId,
      },
    }
  }

  onUpdate(update: AcpUpdate): LogOp[] {
    const kind = update.sessionUpdate
    if (kind === 'agent_message_chunk') {
      const text = acpContentText(update.content)
      if (!text) return []
      this.text += text
      const ops: LogOp[] = []
      if (!this.openedText) {
        this.openedText = true
        ops.push({
          type: 'assistant/chunk',
          data: {
            turn: this.turn,
            step: this.step,
            chunk: { type: 'block-start', index: this.textIndex, blockType: 'text' },
          },
        })
      }
      ops.push({
        type: 'assistant/chunk',
        data: {
          turn: this.turn,
          step: this.step,
          chunk: { type: 'text-delta', index: this.textIndex, text },
        },
      })
      return ops
    }

    if (kind === 'agent_thought_chunk') {
      const text = acpContentText(update.content)
      if (!text) return []
      this.reasoning += text
      const ops: LogOp[] = []
      if (!this.openedReasoning) {
        this.openedReasoning = true
        ops.push({
          type: 'assistant/chunk',
          data: {
            turn: this.turn,
            step: this.step,
            chunk: { type: 'block-start', index: this.reasoningIndex, blockType: 'reasoning' },
          },
        })
      }
      ops.push({
        type: 'assistant/chunk',
        data: {
          turn: this.turn,
          step: this.step,
          chunk: { type: 'reasoning-delta', index: this.reasoningIndex, text },
        },
      })
      return ops
    }

    if (kind === 'tool_call') {
      const id = String(update.toolCallId ?? '')
      if (!id) return []
      const name = typeof update.title === 'string' && update.title
        ? update.title
        : typeof update.kind === 'string' && update.kind ? update.kind : 'tool'
      const args = jsonText(update.rawInput) || '{}'
      this.tools.set(id, { name, arguments: args })
      return [{
        type: 'tool/call',
        data: {
          turn: this.turn,
          step: this.step,
          callId: id,
          name,
          arguments: args,
        },
      }]
    }

    if (kind === 'tool_call_update') {
      const id = String(update.toolCallId ?? '')
      if (!id) return []
      const status = typeof update.status === 'string' ? update.status : ''
      if (status !== 'completed' && status !== 'failed') return []
    const output = jsonText(update.rawOutput) || jsonText(update.content) || (status === 'failed' ? 'failed' : 'ok')
      return [{
        type: 'tool/result',
        data: {
          turn: this.turn,
          step: this.step,
          message: identified('user', [{
            type: 'tool-result',
            toolCallId: id,
            content: [{ type: 'text', text: output }],
            isError: status === 'failed',
          }], { kind: 'tool', callId: id }),
        },
        surface: true,
      }]
    }

    if (kind === 'plan') {
      const text = jsonText(update.entries ?? update.content ?? update)
      if (!text) return []
      return [{
        type: 'assistant/chunk',
        data: {
          turn: this.turn,
          step: this.step,
          chunk: { type: 'reasoning-delta', index: this.reasoningIndex, text: `Plan: ${text}\n` },
        },
      }]
    }

    return []
  }

  noteAssistantText(text: string): void {
    this.text += text
  }

  finish(reason: 'completed' | 'aborted' | 'error', error?: { message: string; code: string }): LogOp[] {
    const content: Array<TextBlock | ReasoningBlock> = []
    if (this.reasoning) content.push({ type: 'reasoning', text: this.reasoning })
    if (this.text) content.push({ type: 'text', text: this.text })
    const ops: LogOp[] = []
    if (content.length > 0) {
      ops.push({
        type: 'assistant/message',
        data: {
          turn: this.turn,
          step: this.step,
          message: identified('assistant', content, {
            kind: 'model',
            provider: this.route.provider,
            model: this.route.model,
          }),
          ...reason === 'aborted' ? { interrupted: true } : {},
        },
        surface: true,
        ...this.chunkSeqs.length > 0 ? { sourceEventSeqs: [...this.chunkSeqs] } : {},
      })
    }
    ops.push({ type: 'step/end', data: { turn: this.turn, step: this.step } })
    ops.push({
      type: 'turn/end',
      data: {
        turn: this.turn,
        reason: reason === 'error' && error
          ? { kind: 'error', error }
          : reason === 'aborted'
            ? { kind: 'aborted', reason: { kind: 'user' } }
            : { kind: 'completed' },
      },
    })
    return ops
  }
}

export function lastBoundAcpSession(events: ReadonlyArray<{ type: string; data: unknown }>): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'request/context' && event?.type !== 'lumine-acp/bound') continue
    const data = event.data as { acpSessionId?: unknown }
    if (typeof data.acpSessionId === 'string' && data.acpSessionId) return data.acpSessionId
  }
  return undefined
}

export function lastBoundWorktree(events: ReadonlyArray<{ type: string; data: unknown }>): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'request/context' && event?.type !== 'lumine-acp/bound') continue
    const data = event.data as { worktreePath?: unknown }
    if (typeof data.worktreePath === 'string' && data.worktreePath.startsWith('/')) return data.worktreePath
  }
  return undefined
}

export function hasRequestHeader(events: ReadonlyArray<{ type: string }>): boolean {
  return events.some(event => event.type === 'request/header')
}

export function routeLabel(provider: ProviderId): string {
  return PROVIDER_LABEL[provider]
}
