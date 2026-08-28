import { describe, expect, it, vi } from 'vitest'
import { createCertifier } from '../src/certifier.ts'
import { fakeJudge } from '../src/judge.ts'
import { makeAgent, makeGoal, makeSession } from './helpers.ts'

describe('worker complete certifier', () => {
  it('REJECTED keeps the phase active and does not call complete()', async () => {
    const goal = makeGoal()
    const complete = vi.fn(() => {
      goal.phase = 'complete'
      return goal
    })
    const certifier = createCertifier({
      judge: fakeJudge('REJECTED', 'proof is a restatement'),
      complete,
      getGoal: () => goal,
      timeoutMs: 1_000,
      failClosed: true,
    })
    const agent = makeAgent(makeSession())
    const result = await certifier.considerWorkerComplete({
      agent,
      ref: { id: goal.id, revision: goal.revision },
      reply: 'GOAL REACHED: shipped',
    })
    expect(result.completed).toBe(false)
    expect(result.verdict.decision).toBe('REJECTED')
    expect(complete).not.toHaveBeenCalled()
    expect(goal.phase).toBe('active')
  })

  it('APPROVED calls complete() once with the matching revision', async () => {
    const goal = makeGoal({ revision: 3 })
    const complete = vi.fn((agent, ref) => {
      expect(ref).toEqual({ id: 'goal-1', revision: 3 })
      goal.phase = 'complete'
      goal.revision = 4
      return goal
    })
    const certifier = createCertifier({
      judge: fakeJudge('APPROVED', 'tests pass and the file exists'),
      complete,
      getGoal: () => goal,
      timeoutMs: 1_000,
      failClosed: true,
    })
    const result = await certifier.considerWorkerComplete({
      agent: makeAgent(makeSession()),
      ref: { id: goal.id, revision: 3 },
      reply: 'GOAL REACHED: tests green',
    })
    expect(result.completed).toBe(true)
    expect(complete).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledWith(expect.anything(), { id: 'goal-1', revision: 3 })
  })

  it('ignores a stale APPROVE after pause or edit', async () => {
    const goal = makeGoal({ revision: 1 })
    const complete = vi.fn()
    let release!: (verdict: { decision: 'APPROVED'; reason: string }) => void
    const certifier = createCertifier({
      judge: () => new Promise(resolve => {
        release = resolve
      }),
      complete,
      getGoal: () => goal,
      timeoutMs: 5_000,
      failClosed: true,
    })
    const agent = makeAgent(makeSession())
    const pending = certifier.considerWorkerComplete({
      agent,
      ref: { id: goal.id, revision: 1 },
      reply: 'GOAL REACHED: old proof',
    })
    goal.revision = 2
    goal.objective = 'Edited objective'
    certifier.onGoalChanged(agent, 'edit')
    release({ decision: 'APPROVED', reason: 'late' })
    const result = await pending
    expect(result.completed).toBe(false)
    expect(result.verdict.decision).toBe('UNVERIFIABLE')
    expect(complete).not.toHaveBeenCalled()
    expect(goal.phase).toBe('active')
  })

  it('certify() APPROVED does not call complete() — the tool body owns that', async () => {
    const goal = makeGoal()
    const complete = vi.fn()
    const certifier = createCertifier({
      judge: fakeJudge('APPROVED', 'ok'),
      complete,
      getGoal: () => goal,
      timeoutMs: 1_000,
      failClosed: true,
    })
    const result = await certifier.certify({
      agent: makeAgent(makeSession()),
      ref: { id: goal.id, revision: goal.revision },
      reply: 'GOAL REACHED: shipped',
    })
    expect(result.completed).toBe(true)
    expect(result.verdict.decision).toBe('APPROVED')
    expect(complete).not.toHaveBeenCalled()
    expect(goal.phase).toBe('active')
  })

  it('does not wrap a direct operator complete()', () => {
    const goal = makeGoal()
    const complete = vi.fn(() => {
      goal.phase = 'complete'
      return goal
    })
    createCertifier({
      judge: fakeJudge('REJECTED', 'would block a worker'),
      complete,
      getGoal: () => goal,
      timeoutMs: 1_000,
      failClosed: true,
    })
    complete({} as never, { id: goal.id, revision: goal.revision })
    expect(goal.phase).toBe('complete')
    expect(complete).toHaveBeenCalledOnce()
  })
})
