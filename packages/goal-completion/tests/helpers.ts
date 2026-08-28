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

export function acpLog(reply: string): SessionEvent[] {
  return [
    acpBind(),
    { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
    {
      type: 'user/message',
      seq: 2,
      time: 2,
      data: {
        id: 'u1',
        role: 'user',
        content: [{ type: 'text', text: 'go' }],
        source: { kind: 'user' },
      },
    },
    assistantMessage(reply),
    turnEnd('completed'),
  ]
}
