import { describe, expect, it, vi } from 'vitest'
import { createCertifier } from '../src/certifier.ts'
import { fakeJudge } from '../src/judge.ts'
import { wrapUpdateGoalTool } from '../src/tools-wrap.ts'
import { makeAgent, makeGoal, makeSession } from './helpers.ts'

describe('update_goal wrap seam', () => {
  it('intercepts action complete before the original execute runs', async () => {
    const goal = makeGoal()
    const original = vi.fn()
    const complete = vi.fn()
    const certifier = createCertifier({
      judge: fakeJudge('REJECTED', 'not yet'),
      complete,
      getGoal: () => goal,
      timeoutMs: 1_000,
      failClosed: true,
    })
    const tool = wrapUpdateGoalTool({ name: 'update_goal', execute: original }, certifier)
    const agent = makeAgent(makeSession())
    await expect(tool.execute?.(
      { action: 'complete', goal_id: goal.id, revision: goal.revision },
      { agent },
    )).rejects.toThrow(/REJECTED/)
    expect(original).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
  })

  it('APPROVED calls complete() once and does not re-enter the original execute', async () => {
    const goal = makeGoal()
    const original = vi.fn(() => ({ goal: { phase: 'complete' } }))
    const complete = vi.fn(() => {
      goal.phase = 'complete'
      return goal
    })
    const certifier = createCertifier({
      judge: fakeJudge('APPROVED', 'ok'),
      complete,
      getGoal: () => goal,
      timeoutMs: 1_000,
      failClosed: true,
    })
    const tool = wrapUpdateGoalTool({ name: 'update_goal', execute: original }, certifier)
    const agent = makeAgent(makeSession())
    const value = await tool.execute?.(
      { action: 'complete', goal_id: goal.id, revision: goal.revision },
      { agent },
    )
    expect(complete).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledWith(agent, { id: goal.id, revision: goal.revision })
    expect(original).not.toHaveBeenCalled()
    expect(value).toMatchObject({ certified: true, verdict: { decision: 'APPROVED' } })
  })

  it('does not intercept pause or edit', async () => {
    const original = vi.fn(() => 'ok')
    const tool = wrapUpdateGoalTool({
      name: 'update_goal',
      execute: original,
    }, createCertifier({
      judge: fakeJudge('REJECTED', 'unused'),
      complete: vi.fn(),
      getGoal: () => makeGoal(),
      timeoutMs: 50,
      failClosed: true,
    }))
    await tool.execute?.({ action: 'pause', goal_id: 'goal-1', revision: 1 }, { agent: makeAgent(makeSession()) })
    expect(original).toHaveBeenCalledOnce()
  })
})
