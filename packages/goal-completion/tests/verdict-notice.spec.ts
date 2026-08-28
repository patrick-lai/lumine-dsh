import { describe, expect, it, vi } from 'vitest'
import { createAcpFallback } from '../src/acp-fallback.ts'
import { createCertifier } from '../src/certifier.ts'
import { fakeJudge } from '../src/judge.ts'
import { pluginNotice, recordVerdictNotice, verdictLine } from '../src/pin.ts'
import { acpLog, makeAgent, makeGoal, makeSession, publishedAppend } from './helpers.ts'

describe('durable GOAL COMPLETION VERDICT append', () => {
  it('published Session.append rejects a 2-arg user/message the way live DSH does', () => {
    const events: Array<{ type: string; seq: number; time: number; data: unknown; surfaceOp?: unknown }> = []
    const append = publishedAppend(events)
    const notice = pluginNotice('GOAL COMPLETION VERDICT: UNVERIFIABLE - missing start', 'x')
    expect(() => append('user/message', notice)).toThrow(
      'session event "user/message" is surface-eligible and requires a surfaceOp marker',
    )
    expect(events).toHaveLength(0)
  })

  it('recordVerdictNotice uses the published 3-arg surface append, not a 2-arg stub', () => {
    const events: Array<{ type: string; seq: number; time: number; data: unknown; surfaceOp?: unknown }> = []
    const session = { events, append: publishedAppend(events) }
    const verdict = { decision: 'UNVERIFIABLE' as const, reason: 'no read-only judge is available' }
    const text = recordVerdictNotice({ session }, verdict)

    expect(text).toBe(verdictLine(verdict))
    expect(events).toHaveLength(1)
    const event = events[0]
    expect(event?.type).toBe('user/message')
    expect(event?.surfaceOp).toBe('append')
    expect(event?.seq).toBe(0)
    const data = event?.data as {
      id?: string
      role?: string
      content?: Array<{ type?: string; text?: string }>
      source?: { kind?: string; plugin?: string; form?: string; summary?: string }
      turn?: unknown
    }
    expect(typeof data.id).toBe('string')
    expect(data.id?.length).toBeGreaterThan(0)
    expect(data.role).toBe('user')
    expect(data.content).toEqual([{ type: 'text', text }])
    expect(data.source).toEqual({
      kind: 'plugin',
      plugin: 'lumine-goal-completion',
      form: 'notice',
      summary: text,
    })
    expect(data.turn).toBeUndefined()
  })

  it('APPROVED verdict is the same published user/message surface append', () => {
    const events: Array<{ type: string; seq: number; time: number; data: unknown; surfaceOp?: unknown }> = []
    const text = recordVerdictNotice(
      { session: { events, append: publishedAppend(events) } },
      { decision: 'APPROVED', reason: 'file is exactly pong' },
    )
    expect(text).toBe('GOAL COMPLETION VERDICT: APPROVED - file is exactly pong')
    expect(events[0]?.surfaceOp).toBe('append')
    expect((events[0]?.data as { content: Array<{ text: string }> }).content[0]?.text).toBe(text)
  })

  it('GOAL REACHED harvest writes the verdict through published Session.append', async () => {
    const goal = makeGoal()
    const durable: Array<{ type: string; seq: number; time: number; data: unknown; surfaceOp?: unknown }> = []
    const session = makeSession(acpLog('Wrote pong.\nGOAL REACHED: file is exactly pong'))
    session.append = publishedAppend(durable) as typeof session.append
    const complete = vi.fn((agent, ref) => {
      goal.phase = 'complete'
      return { ...goal, ...ref, phase: 'complete' as const }
    })
    const result = await createAcpFallback({
      certifier: createCertifier({
        judge: fakeJudge('APPROVED', 'file is exactly pong'),
        complete,
        getGoal: () => goal,
        timeoutMs: 1_000,
        failClosed: true,
      }),
      goals: { get: () => goal, complete, block: vi.fn() },
      sessionIsLumineAcp: true,
      roundDriverPresent: false,
    }).onSettledTurn({
      agent: makeAgent(session),
      session,
      endKind: 'completed',
    })
    expect(result.action).toBe('complete')
    expect(complete).toHaveBeenCalledOnce()
    expect(durable).toHaveLength(1)
    expect(durable[0]?.type).toBe('user/message')
    expect(durable[0]?.surfaceOp).toBe('append')
    expect((durable[0]?.data as { content: Array<{ text: string }> }).content[0]?.text).toBe(
      'GOAL COMPLETION VERDICT: APPROVED - file is exactly pong',
    )
  })
})
