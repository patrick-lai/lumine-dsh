import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/plugin.ts'
import { createAcpFallback } from '../src/acp-fallback.ts'
import { createCertifier } from '../src/certifier.ts'
import { fakeJudge } from '../src/judge.ts'
import { canMountAcpFallback, hasRoundDriver } from '../src/session.ts'
import { acpLog, makeAgent, makeGoal, makeSession } from './helpers.ts'

describe('never mount ACP fallback beside the goal-round-driver', () => {
  it('refuses the marker loop when the round-driver is present', () => {
    expect(canMountAcpFallback({ sessionIsLumineAcp: true, roundDriverPresent: true })).toBe(false)
    expect(canMountAcpFallback({ sessionIsLumineAcp: true, roundDriverPresent: false })).toBe(true)
    expect(canMountAcpFallback({ sessionIsLumineAcp: false, roundDriverPresent: false })).toBe(false)
  })

  it('detects the official driver plugin id', () => {
    expect(hasRoundDriver({ registry: new Map([['goal-round-driver', {}]]) })).toBe(true)
    expect(hasRoundDriver({ registry: new Map([['@deepseek-ai/dsh-goal-round-driver', {}]]) })).toBe(true)
    expect(hasRoundDriver({ registry: new Map([['lumine-acp-session', {}]]) })).toBe(false)
  })

  it('does not nudge or complete when the fallback is refused', async () => {
    const goal = makeGoal()
    const complete = vi.fn()
    const followups: unknown[] = []
    const session = makeSession(acpLog('GOAL REACHED: should not harvest next to the driver'))
    const fallback = createAcpFallback({
      certifier: createCertifier({
        judge: fakeJudge('APPROVED', 'would complete if mounted'),
        complete,
        getGoal: () => goal,
        timeoutMs: 1_000,
        failClosed: true,
      }),
      goals: { get: () => goal, complete, block: vi.fn() },
      sessionIsLumineAcp: true,
      roundDriverPresent: true,
    })
    expect(fallback.mounted).toBe(false)
    const result = await fallback.onSettledTurn({
      agent: makeAgent(session, followups),
      session,
      endKind: 'completed',
    })
    expect(result.action).toBe('ignore')
    expect(complete).not.toHaveBeenCalled()
    expect(followups).toHaveLength(0)
  })

  it('apply() with a loaded round-driver does not start the ACP loop', async () => {
    const followups: unknown[] = []
    const session = makeSession(acpLog('still going'))
    const agent = makeAgent(session, followups)
    const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
    const ctx = {
      logger: { warn() {}, info() {}, error() {} },
      goals: {
        get: () => makeGoal(),
        complete: vi.fn(),
        block: vi.fn(),
      },
      agents: { get: () => agent },
      registry: new Map([['goal-round-driver', { name: 'goal-round-driver' }]]),
      fiber: { state: 2, children: [{ name: 'goal-round-driver' }] },
      inject(_deps: string[], callback: (inner: typeof ctx) => void) {
        callback(ctx)
        return { dispose() {} }
      },
      on(event: string, listener: (...args: unknown[]) => unknown) {
        const bucket = listeners.get(event) ?? []
        bucket.push(listener)
        listeners.set(event, bucket)
        return () => {}
      },
    }
    apply(ctx as never, { fakeJudge: true, timeoutMs: 50 })
    for (const listener of listeners.get('session/event') ?? []) {
      await listener(session, session.events.find(event => event.type === 'turn/end'))
    }
    expect(followups).toHaveLength(0)
    expect(ctx.goals.complete).not.toHaveBeenCalled()
  })
})
