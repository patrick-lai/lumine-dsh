import { describe, expect, it, vi } from 'vitest'
import { createAcpFallback } from '../src/acp-fallback.ts'
import { createCertifier } from '../src/certifier.ts'
import { fakeJudge } from '../src/judge.ts'
import { continueNudge } from '../src/pin.ts'
import { acpLog, makeAgent, makeGoal, makeSession } from './helpers.ts'

describe('ACP marker harvest', () => {
  it('GOAL REACHED on an ACP-shaped log is a candidate; fake APPROVED completes once', async () => {
    const goal = makeGoal()
    const complete = vi.fn((agent, ref) => {
      goal.phase = 'complete'
      return { ...goal, ...ref, phase: 'complete' as const }
    })
    const certifier = createCertifier({
      judge: fakeJudge('APPROVED', 'checkout matches the objective'),
      complete,
      getGoal: () => goal,
      timeoutMs: 1_000,
      failClosed: true,
    })
    const followups: Array<{ content: Array<{ text?: string }> }> = []
    const session = makeSession(acpLog('Work done.\nGOAL REACHED: shipped the certifier'))
    const agent = makeAgent(session, followups)
    const fallback = createAcpFallback({
      certifier,
      goals: { get: () => goal, complete, block: vi.fn() },
      sessionIsLumineAcp: true,
      roundDriverPresent: false,
    })
    const result = await fallback.onSettledTurn({ agent, session, endKind: 'completed' })
    expect(result.action).toBe('complete')
    expect(complete).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledWith(agent, { id: 'goal-1', revision: 1 })
    expect(followups).toHaveLength(0)
  })

  it('records a continue nudge and does not complete when the marker is absent', async () => {
    const goal = makeGoal()
    const complete = vi.fn()
    const certifier = createCertifier({
      judge: fakeJudge('APPROVED', 'should not run'),
      complete,
      getGoal: () => goal,
      timeoutMs: 1_000,
      failClosed: true,
    })
    const followups: Array<{ content: Array<{ text?: string }>; source?: { plugin?: string } }> = []
    const session = makeSession(acpLog('Still working on the remaining files.'))
    const agent = makeAgent(session, followups)
    const fallback = createAcpFallback({
      certifier,
      goals: { get: () => goal, complete, block: vi.fn() },
      sessionIsLumineAcp: true,
      roundDriverPresent: false,
    })
    const result = await fallback.onSettledTurn({ agent, session, endKind: 'completed' })
    expect(result.action).toBe('nudge')
    expect(complete).not.toHaveBeenCalled()
    expect(followups).toHaveLength(1)
    const text = followups[0]?.content[0]?.text ?? ''
    expect(text).toContain('PINNED GOAL — not yet reached (auto-continue round 1)')
    expect(text).toBe(continueNudge(goal.objective, 1))
    expect(followups[0]?.source?.plugin).toBe('lumine-goal-completion')
    expect(goal.phase).toBe('active')
  })

  it('BLOCKED calls goals.block and does not invent a 3-round policy', async () => {
    const goal = makeGoal()
    const block = vi.fn((agent, ref, reason) => {
      goal.phase = 'blocked'
      return { ...goal, ...ref, phase: 'blocked' as const, blockedReason: reason }
    })
    const fallback = createAcpFallback({
      certifier: createCertifier({
        judge: fakeJudge('APPROVED', 'unused'),
        complete: vi.fn(),
        getGoal: () => goal,
        timeoutMs: 1_000,
        failClosed: true,
      }),
      goals: { get: () => goal, complete: vi.fn(), block },
      sessionIsLumineAcp: true,
      roundDriverPresent: false,
    })
    const session = makeSession(acpLog('Need a secret.\nBLOCKED: deploy key'))
    const result = await fallback.onSettledTurn({
      agent: makeAgent(session),
      session,
      endKind: 'completed',
    })
    expect(result.action).toBe('block')
    expect(block).toHaveBeenCalledOnce()
    expect(block.mock.calls[0]?.[2]).toEqual({ code: 'model-reported', message: 'deploy key' })
  })
})
