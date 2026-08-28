import { describe, expect, it, vi } from 'vitest'
import { createAcpFallback } from '../src/acp-fallback.ts'
import { createCertifier } from '../src/certifier.ts'
import { createRuntimeJudge, fakeJudge, START_DID_NOT_SETTLE } from '../src/judge.ts'
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

  it('start() that never resolves emits UNVERIFIABLE, clears judging, and uses surfaceOp append', async () => {
    const goal = makeGoal()
    const start = vi.fn(() => new Promise(() => {}))
    const session = makeSession(acpLog('GOAL REACHED: file is exactly pong'))
    const durable = session.events as Array<{ type: string; seq: number; time: number; data: unknown; surfaceOp?: unknown }>
    session.append = publishedAppend(durable) as typeof session.append
    const agent = makeAgent(session)
    const complete = vi.fn()
    const judge = createRuntimeJudge({
      logger: { warn() {}, info() {}, error() {} },
      subagents: {
        start,
        list: () => ['acp'],
        getProvider: () => ({ name: 'acp', capabilities: { toolFilter: true } }),
      },
    } as never, {
      timeoutMs: 5_000,
      startTimeoutMs: 25,
      failClosed: true,
      fakeJudge: false,
    })
    const fallback = createAcpFallback({
      certifier: createCertifier({
        judge,
        complete,
        getGoal: () => goal,
        timeoutMs: 5_000,
        failClosed: true,
      }),
      goals: { get: () => goal, complete, block: vi.fn() },
      sessionIsLumineAcp: true,
      roundDriverPresent: false,
    })
    const result = await fallback.onSettledTurn({ agent, session, endKind: 'completed' })
    expect(start).toHaveBeenCalledOnce()
    expect(result.action).toBe('halt')
    expect(fallback.state(agent).judging).toBe(false)
    expect(complete).not.toHaveBeenCalled()
    const notices = durable.filter(event => event.type === 'user/message' && event.surfaceOp === 'append')
    expect(notices).toHaveLength(1)
    expect((notices[0]?.data as { content: Array<{ text: string }> }).content[0]?.text).toBe(
      `GOAL COMPLETION VERDICT: UNVERIFIABLE - ${START_DID_NOT_SETTLE}`,
    )
    const second = await fallback.onSettledTurn({ agent, session, endKind: 'completed' })
    expect(second.action).toBe('ignore')
  })
})
