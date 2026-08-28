import { describe, expect, it, vi } from 'vitest'
import { createCertifier } from '../src/certifier.ts'
import { fakeJudge } from '../src/judge.ts'
import {
  aroundUpdateGoalExecute,
  installToolsExecuteWrap,
  wrapUpdateGoalTool,
} from '../src/tools-wrap.ts'
import { makeAgent, makeGoal, makeSession } from './helpers.ts'

/**
 * Local stand-in for `@deepseek-ai/dsh-tools` `defineTool` + registry dispatch.
 * Validates the published `update_goal` output `{ goal, activation }` the same
 * way `ToolRuntime` throws `ToolOutputError` on a contract miss.
 */
function defineTool<T extends {
  name: string
  output: { schema: { required?: string[] } }
  execute: (args: Record<string, unknown>, exec: { agent?: unknown; signal: AbortSignal }) => unknown
}>(definition: T): T {
  return definition
}

class ToolOutputError extends Error {
  readonly violations: string[]
  constructor(toolName: string, violations: string[]) {
    super(`tool "${toolName}" returned invalid output: ${violations.join('; ')}`)
    this.name = 'ToolOutputError'
    this.violations = violations
  }
}

const GOAL_OUTPUT_REQUIRED = ['goal', 'activation'] as const

function assertGoalToolOutput(toolName: string, value: unknown): asserts value is {
  goal: Record<string, unknown>
  activation: 'armed' | 'disarmed'
} {
  if (!value || typeof value !== 'object') {
    throw new ToolOutputError(toolName, ['value is not an object'])
  }
  const record = value as Record<string, unknown>
  const violations: string[] = []
  for (const key of GOAL_OUTPUT_REQUIRED) {
    if (!(key in record)) violations.push(`value must have required property '${key}'`)
  }
  if (record.activation !== 'armed' && record.activation !== 'disarmed') {
    violations.push('value.activation must be "armed" or "disarmed"')
  }
  if (record.goal === null || typeof record.goal !== 'object') {
    violations.push('value.goal must be an object')
  }
  if (violations.length > 0) throw new ToolOutputError(toolName, violations)
}

function createRegistry() {
  const tools = new Map<string, ReturnType<typeof defineTool>>()
  const hooks: Array<(exec: { name: string; arguments: Record<string, unknown>; agent?: unknown }, next: () => Promise<unknown>) => unknown> = []
  return {
    register(tool: ReturnType<typeof defineTool>) {
      tools.set(tool.name, tool)
    },
    on(event: string, listener: (...args: unknown[]) => unknown) {
      if (event === 'tools/execute') hooks.push(listener as (typeof hooks)[number])
    },
    async execute(input: { name: string; arguments: Record<string, unknown>; agent?: unknown; signal?: AbortSignal }) {
      const tool = tools.get(input.name)
      if (!tool) throw new Error(`unknown tool "${input.name}"`)
      const exec = {
        name: input.name,
        arguments: input.arguments,
        agent: input.agent,
        signal: input.signal ?? new AbortController().signal,
      }
      const body = async () => {
        const value = await tool.execute(exec.arguments, exec)
        assertGoalToolOutput(tool.name, value)
        return value
      }
      let index = 0
      const next = (): Promise<unknown> => {
        const hook = hooks[index]
        index += 1
        return Promise.resolve(hook ? hook(exec, next) : body())
      }
      return next()
    },
  }
}

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

  it('APPROVED calls original execute once and does not complete() itself', async () => {
    const goal = makeGoal()
    const complete = vi.fn()
    const original = vi.fn(() => {
      goal.phase = 'complete'
      goal.activation = 'disarmed'
      return {
        goal: {
          id: goal.id,
          revision: goal.revision,
          objective: goal.objective,
          phase: goal.phase,
          roundsStarted: 1,
          maxGoalRounds: 16,
        },
        activation: goal.activation,
      }
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
    expect(complete).not.toHaveBeenCalled()
    expect(original).toHaveBeenCalledOnce()
    expect(value).toEqual({
      goal: expect.objectContaining({ phase: 'complete' }),
      activation: 'disarmed',
    })
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

  it('defineTool + registry dispatch of approved update_goal returns { goal, activation }', async () => {
    const goal = makeGoal()
    const complete = vi.fn((agent, ref) => {
      expect(ref).toEqual({ id: goal.id, revision: goal.revision })
      goal.phase = 'complete'
      goal.activation = 'disarmed'
      return goal
    })
    const certifier = createCertifier({
      judge: fakeJudge('APPROVED', 'checkout matches'),
      complete,
      getGoal: () => goal,
      timeoutMs: 1_000,
      failClosed: true,
    })

    const updateGoal = defineTool({
      name: 'update_goal',
      output: { schema: { required: ['goal', 'activation'] } },
      execute(args, exec) {
        if (args.action !== 'complete') throw new Error('expected complete')
        const view = complete(exec.agent, { id: args.goal_id as string, revision: args.revision as number })
        return {
          goal: {
            id: view.id,
            revision: view.revision,
            objective: view.objective,
            phase: view.phase,
            roundsStarted: 1,
            maxGoalRounds: 16,
          },
          activation: view.activation,
        }
      },
    })

    const registry = createRegistry()
    registry.register(updateGoal)
    installToolsExecuteWrap(registry, certifier)

    const agent = makeAgent(makeSession())
    const value = await registry.execute({
      name: 'update_goal',
      arguments: { action: 'complete', goal_id: goal.id, revision: goal.revision },
      agent,
      signal: new AbortController().signal,
    })

    expect(value).toMatchObject({
      goal: { id: 'goal-1', phase: 'complete' },
      activation: 'disarmed',
    })
    expect(complete).toHaveBeenCalledOnce()
    expect(goal.phase).toBe('complete')
  })

  it('registry dispatch of rejected update_goal never runs the body', async () => {
    const complete = vi.fn()
    const body = vi.fn()
    const certifier = createCertifier({
      judge: fakeJudge('UNVERIFIABLE', 'no judge'),
      complete,
      getGoal: () => makeGoal(),
      timeoutMs: 1_000,
      failClosed: true,
    })
    const registry = createRegistry()
    registry.register(defineTool({
      name: 'update_goal',
      output: { schema: { required: ['goal', 'activation'] } },
      execute: body,
    }))
    installToolsExecuteWrap(registry, certifier)
    await expect(registry.execute({
      name: 'update_goal',
      arguments: { action: 'complete', goal_id: 'goal-1', revision: 1 },
      agent: makeAgent(makeSession()),
    })).rejects.toThrow(/UNVERIFIABLE/)
    expect(body).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
  })

  it('around-hook ignores tools other than update_goal', async () => {
    const next = vi.fn(async () => 'ok')
    const value = await aroundUpdateGoalExecute(
      { name: 'get_goal', arguments: {}, agent: makeAgent(makeSession()) },
      next,
      createCertifier({
        judge: fakeJudge('REJECTED', 'unused'),
        complete: vi.fn(),
        getGoal: () => makeGoal(),
        timeoutMs: 50,
        failClosed: true,
      }),
    )
    expect(value).toBe('ok')
    expect(next).toHaveBeenCalledOnce()
  })
})
