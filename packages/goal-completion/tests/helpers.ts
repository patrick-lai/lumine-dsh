import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { GoalView } from '../src/certifier.ts'

export interface MutableGoal extends GoalView {
  activation: 'armed' | 'disarmed'
}

export function makeGoal(overrides: Partial<MutableGoal> = {}): MutableGoal {
  return {
    id: 'goal-1',
    revision: 1,
    objective: 'Ship the harvest certifier',
    phase: 'active',
    activation: 'armed',
    ...overrides,
  }
}

export function makeSession(events: SessionEvent[] = [], preset = 'grok-build'): Session {
  return {
    id: 'session-1' as Session['id'],
    header: { agentPreset: preset },
    events,
    append(type: string, data: unknown) {
      const event = { type, seq: events.length + 1, time: Date.now(), data }
      events.push(event)
      return event
    },
  }
}

export function assistantMessage(text: string, turn = 1): SessionEvent {
  return {
    type: 'assistant/message',
    seq: turn,
    time: Date.now(),
    data: {
      turn,
      step: 1,
      message: {
        id: `a-${turn}`,
        role: 'assistant',
        content: [{ type: 'text', text }],
        source: { kind: 'model', provider: 'grok', model: 'grok-4.6' },
      },
    },
  }
}

export function turnEnd(kind: 'completed' | 'aborted' | 'error' = 'completed', turn = 1): SessionEvent {
  return {
    type: 'turn/end',
    seq: turn + 100,
    time: Date.now(),
    data: { turn, reason: { kind } },
  }
}

export function acpBind(): SessionEvent {
  return {
    type: 'request/context',
    seq: 0,
    time: Date.now(),
    data: { provider: 'grok', model: 'grok-4.6', acpSessionId: 'acp-1' },
  }
}

export function makeAgent(session: Session, followups: unknown[] = []): Agent {
  return {
    id: session.id,
    options: { provider: 'grok', model: 'grok-4.6' },
    session,
    status: 'idle',
    ctx: {} as Agent['ctx'],
    followup(message) { followups.push(message) },
    inject(message) { followups.push(message) },
  }
}

export function userMessage(
  text: string,
  source: { kind: string; plugin?: string } = { kind: 'user' },
  turn = 1,
): SessionEvent {
  return {
    type: 'user/message',
    seq: turn,
    time: Date.now(),
    data: {
      id: `u-${turn}`,
      role: 'user',
      content: [{ type: 'text', text }],
      source,
    },
  }
}

export function nativeLog(reply: string): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
    userMessage('go'),
    assistantMessage(reply),
    turnEnd('completed'),
  ]
}

export function acpLog(reply: string, source: { kind: string; plugin?: string } = { kind: 'user' }): SessionEvent[] {
  return [
    acpBind(),
    { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
    userMessage('go', source),
    assistantMessage(reply),
    turnEnd('completed'),
  ]
}

/** Published ACP shape: text lives in `assistant/chunk` text-deltas; message content is empty. */
export function acpChunkLog(reply: string, source: { kind: string; plugin?: string } = { kind: 'user' }): SessionEvent[] {
  return [
    acpBind(),
    { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
    userMessage('go', source),
    {
      type: 'assistant/chunk',
      seq: 2,
      time: 2,
      data: { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
    },
    {
      type: 'assistant/chunk',
      seq: 3,
      time: 3,
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: reply } },
    },
    {
      type: 'assistant/message',
      seq: 4,
      time: 4,
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'a-1',
          role: 'assistant',
          content: [],
          source: { kind: 'model', provider: 'grok', model: 'grok-4.6' },
        },
      },
    },
    turnEnd('completed'),
  ]
}

const SURFACE_TYPES = new Set(['user/message', 'assistant/message', 'tool/result'])

function isJsonSafe(value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) return false
    JSON.parse(serialized)
    return true
  } catch {
    return false
  }
}

function assertIdentifiedUserMessage(data: unknown): void {
  if (!data || typeof data !== 'object') throw new Error('session event at seq 0 lacks an identified message')
  const message = data as Record<string, unknown>
  if (typeof message.id !== 'string' || message.id === '') {
    throw new Error('session event lacks an identified message')
  }
  if (message.role !== 'user') throw new Error('session event message must have role "user"')
  if (!Array.isArray(message.content)) throw new Error('session event message has invalid content')
  const source = message.source as { kind?: unknown } | undefined
  if (!source || typeof source !== 'object' || typeof source.kind !== 'string' || source.kind === '') {
    throw new Error('session event message has invalid source')
  }
}

/**
 * Published `@deepseek-ai/dsh-session` `Session.append` contract used by
 * lumine-acp-session / the official loop. Surface types require
 * `{ surfaceOp: 'append' }`. A 2-arg `user/message` throw is the live miss.
 */
export function publishedAppend(
  events: Array<{ type: string; seq: number; time: number; data: unknown; surfaceOp?: unknown }>,
): (
  type: string,
  data: unknown,
  opts?: { surfaceOp?: 'append' | { op: 'replace'; start: number; end: number }; sourceEventSeqs?: number[] },
) => { type: string; seq: number; time: number; data: unknown; surfaceOp?: unknown } {
  return (type, data, opts) => {
    if (!isJsonSafe(data)) {
      throw new Error(`session event "${type}" carries non-JSON-serializable data`)
    }
    if (SURFACE_TYPES.has(type)) {
      if (opts?.surfaceOp === undefined) {
        throw new Error(`session event "${type}" is surface-eligible and requires a surfaceOp marker`)
      }
      if (opts.surfaceOp !== 'append' && (typeof opts.surfaceOp !== 'object' || opts.surfaceOp.op !== 'replace')) {
        throw new Error(`session event "${type}" carries an invalid surfaceOp`)
      }
    } else if (opts?.surfaceOp !== undefined) {
      throw new Error(`session event "${type}" is not surface-eligible and cannot carry surfaceOp`)
    }
    if (type === 'user/message') assertIdentifiedUserMessage(data)
    if (data && typeof data === 'object') {
      const turn = (data as { turn?: unknown }).turn
      if (turn !== undefined && (typeof turn !== 'number' || !Number.isFinite(turn))) {
        throw new Error(`session event "${type}" carries non-JSON-serializable data`)
      }
    }
    const event = {
      type,
      seq: events.length,
      time: Date.now(),
      data,
      ...opts?.surfaceOp === undefined ? {} : { surfaceOp: opts.surfaceOp },
    }
    events.push(event)
    return event
  }
}

export function sessionNoticeTexts(session: { events: ReadonlyArray<{ type: string; data?: unknown }> }): string[] {
  const texts: string[] = []
  for (const event of session.events) {
    if (event.type !== 'user/message') continue
    const data = event.data as { content?: Array<{ text?: string }>; message?: { content?: Array<{ text?: string }> } } | undefined
    const blocks = data?.content ?? data?.message?.content ?? []
    for (const block of blocks) {
      if (typeof block.text === 'string') texts.push(block.text)
    }
  }
  return texts
}
