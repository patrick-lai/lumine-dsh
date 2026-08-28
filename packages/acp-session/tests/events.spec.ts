import { describe, expect, it } from 'vitest'
import { TurnProjector, lastBoundAcpSession, userMessageText } from '../src/events.ts'

function types(ops: Array<{ type: string }>): string[] {
  return ops.map(op => op.type)
}

describe('TurnProjector ACP → DSH session log', () => {
  const user = {
    id: 'u1',
    role: 'user',
    content: [{ type: 'text', text: 'hello' }],
    source: { kind: 'user' },
  }

  it('opens a turn, logs the user message, then streams text/thought/tools', () => {
    const projector = new TurnProjector(1, 1, { provider: 'cursor', model: 'cursor' })
    const log = [
      ...projector.startTurn(user),
      ...projector.syntheticHeader('initial'),
      projector.bind('acp-session-1'),
      ...projector.onUpdate({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'hmm' },
      }),
      ...projector.onUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hi ' },
      }),
      ...projector.onUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'there' },
      }),
      ...projector.onUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'read',
        rawInput: { path: 'a.ts' },
      }),
      ...projector.onUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        status: 'completed',
        rawOutput: { text: 'ok' },
      }),
      ...projector.finish('completed'),
    ]

    expect(types(log)).toEqual([
      'turn/start',
      'user/message',
      'step/start',
      'request/header',
      'request/context',
      'assistant/chunk',
      'assistant/chunk',
      'assistant/chunk',
      'assistant/chunk',
      'tool/call',
      'tool/result',
      'assistant/message',
      'step/end',
      'turn/end',
    ])

    expect(log[0]?.data).toEqual({ turn: 1 })
    expect(log[1]?.surface).toBe(true)
    expect(lastBoundAcpSession(log)).toBe('acp-session-1')
    expect((log.find(op => op.type === 'request/context')?.data as { acpSessionId?: string }).acpSessionId).toBe('acp-session-1')
    const chunks = log.filter(op => op.type === 'assistant/chunk').map(op => (op.data as { chunk: { type: string; text?: string } }).chunk)
    expect(chunks.some(chunk => chunk.type === 'reasoning-delta' && chunk.text === 'hmm')).toBe(true)
    expect(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')).toBe('Hi there')

    const call = log.find(op => op.type === 'tool/call')?.data as { name: string; arguments: string }
    expect(call.name).toBe('read')
    expect(call.arguments).toContain('a.ts')

    const end = log.at(-1)?.data as { reason: { kind: string } }
    expect(end.reason.kind).toBe('completed')
  })

  it('records an aborted finish without claiming completion', () => {
    const projector = new TurnProjector(2, 1, { provider: 'claude', model: 'claude' })
    projector.onUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'partial' },
    })
    const end = projector.finish('aborted').at(-1)
    expect(end?.type).toBe('turn/end')
    expect((end?.data as { reason: { kind: string } }).reason.kind).toBe('aborted')
  })

  it('extracts user text and finds a bound ACP session id', () => {
    expect(userMessageText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('a\nb')
    expect(lastBoundAcpSession([
      { type: 'turn/start', data: {} },
      { type: 'request/context', data: { provider: 'grok', model: 'grok', acpSessionId: 's-9' } },
    ])).toBe('s-9')
  })
})
