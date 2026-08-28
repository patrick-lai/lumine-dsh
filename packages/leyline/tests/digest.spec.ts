import { describe, expect, it } from 'vitest'
import { digestSession } from '../src/digest.ts'
import { settleIdempotencyKey } from '../src/payloads.ts'
import type { Session } from '@deepseek-ai/dsh-session'

function session(events: Array<{ type: string; data: unknown; time?: number }>): Session {
  return {
    id: 'sess-9' as Session['id'],
    header: {
      version: 1,
      id: 'sess-9' as Session['id'],
      createdAt: Date.parse('2026-08-28T09:00:00Z'),
      cwd: '/tmp/ws',
      agentPreset: 'grok-build',
    },
    events: events.map((event, seq) => ({
      type: event.type,
      seq,
      time: event.time ?? Date.parse('2026-08-28T09:30:00Z'),
      data: event.data,
    })),
    append() { throw new Error('unused') },
  }
}

describe('session digest', () => {
  it('builds a bounded digest and a success receipt from turn/end', () => {
    const digest = digestSession(session([
      {
        type: 'user/message',
        data: { message: { content: [{ type: 'text', text: 'Fix flaky test' }] } },
      },
      { type: 'assistant/message', data: { text: 'Root cause: race in the cache.' } },
      { type: 'turn/end', data: { reason: { kind: 'completed' } } },
    ]), ['recall_abc123'])
    expect(digest.result).toBe('success')
    expect(digest.receipt.recall_ids).toEqual(['recall_abc123'])
    expect(digest.digest).toContain('GOAL: Fix flaky test')
    expect(digest.digest).toContain('RECALLS: recall_abc123')
    expect(digest.tail).toContain('Fix flaky test')
    expect(settleIdempotencyKey('sess-9')).toBe('lumine-dsh-settle-sess-9')
  })

  it('marks an error turn as failed', () => {
    const digest = digestSession(session([
      { type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'boom' } } } },
    ]))
    expect(digest.result).toBe('failed')
    expect(digest.label).toContain('boom')
  })
})
