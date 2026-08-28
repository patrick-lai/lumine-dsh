import { describe, expect, it, vi } from 'vitest'
import { createRuntimeJudge, judgeToolFilter, pickStartProvider } from '../src/judge.ts'
import { makeAgent, makeSession } from './helpers.ts'

describe('runtime judge start() shape', () => {
  it('calls subagents.start(name, { prompt: ContentBlock[], parent, signal, toolFilter })', async () => {
    const parent = makeAgent(makeSession())
    const dispose = vi.fn()
    const start = vi.fn(async (_name: string, request: {
      prompt: Array<{ type: string; text?: string }>
      parent: unknown
      signal: AbortSignal
      toolFilter?: { allow?: string[]; deny?: string[] }
    }) => {
      expect(Array.isArray(request.prompt)).toBe(true)
      expect(request.prompt[0]).toEqual({ type: 'text', text: expect.stringContaining('ORIGINAL OBJECTIVE') })
      expect(request.parent).toBe(parent)
      expect(request.signal).toBeInstanceOf(AbortSignal)
      expect(request.toolFilter).toEqual({ deny: ['bash', 'write'] })
      return {
        result: Promise.resolve({
          output: [{ type: 'text', text: 'GOAL COMPLETION VERDICT: APPROVED - tests pass' }],
          stopReason: 'completed',
        }),
        dispose,
      }
    })
    const ctx = {
      logger: { warn() {}, info() {}, error() {} },
      tools: {
        register() {},
        schemas: () => [{ name: 'read' }, { name: 'bash' }, { name: 'write' }, { name: 'get_goal' }],
      },
      llm: { listProviders: () => [{ id: 'claude' }, { id: 'grok' }] },
      subagents: {
        start,
        list: () => ['spawn', 'acp'],
        getProvider: (name: string) => ({
          name,
          capabilities: {
            toolFilter: name === 'spawn',
            agentOptions: name === 'spawn',
          },
        }),
      },
    }
    const judge = createRuntimeJudge(ctx as never, {
      timeoutMs: 1_000,
      failClosed: true,
      fakeJudge: false,
    })
    const verdict = await judge({
      goalId: 'goal-1',
      revision: 1,
      objective: 'Ship the harvest certifier',
      reply: 'GOAL REACHED: shipped',
      parent,
    }, new AbortController().signal)
    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0]?.[0]).toBe('spawn')
    const request = start.mock.calls[0]?.[1] as { agentOptions?: { provider: string } }
    expect(request.agentOptions).toEqual({ provider: 'claude' })
    expect(verdict).toEqual({ decision: 'APPROVED', reason: 'tests pass' })
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('fail-closes UNVERIFIABLE when start() is missing', async () => {
    const judge = createRuntimeJudge({
      logger: { warn() {}, info() {}, error() {} },
      subagents: { list: () => ['spawn'] },
    } as never, {
      timeoutMs: 1_000,
      failClosed: true,
      fakeJudge: false,
    })
    const verdict = await judge({
      goalId: 'goal-1',
      revision: 1,
      objective: 'x',
      reply: 'y',
      parent: makeAgent(makeSession()),
    }, new AbortController().signal)
    expect(verdict.decision).toBe('UNVERIFIABLE')
    expect(verdict.reason).toMatch(/no read-only judge/)
  })

  it('fail-closes UNVERIFIABLE when start() throws', async () => {
    const warn = vi.fn()
    const judge = createRuntimeJudge({
      logger: { warn, info() {}, error() {} },
      subagents: {
        start: async () => {
          throw new Error('NO_PROVIDER')
        },
        list: () => ['spawn'],
        getProvider: () => ({ name: 'spawn', capabilities: { toolFilter: true } }),
      },
    } as never, {
      timeoutMs: 1_000,
      failClosed: true,
      fakeJudge: false,
    })
    const verdict = await judge({
      goalId: 'goal-1',
      revision: 1,
      objective: 'x',
      reply: 'y',
      parent: makeAgent(makeSession()),
    }, new AbortController().signal)
    expect(verdict.decision).toBe('UNVERIFIABLE')
    expect(verdict.reason).toMatch(/did not finish/)
    expect(warn).toHaveBeenCalled()
  })

  it('does not pass a fictional run/spawn payload', async () => {
    const start = vi.fn(async () => {
      throw new Error('unused')
    })
    const judge = createRuntimeJudge({
      logger: { warn() {}, info() {}, error() {} },
      subagents: {
        start,
        run: vi.fn(),
        spawn: vi.fn(),
        list: () => ['spawn'],
        getProvider: () => ({ name: 'spawn', capabilities: { toolFilter: true } }),
      },
    } as never, {
      timeoutMs: 1_000,
      failClosed: true,
      fakeJudge: false,
    })
    await judge({
      goalId: 'goal-1',
      revision: 1,
      objective: 'x',
      reply: 'y',
      parent: makeAgent(makeSession()),
    }, new AbortController().signal)
    expect(start).toHaveBeenCalledOnce()
    const request = start.mock.calls[0]?.[1] as Record<string, unknown>
    expect(request).not.toHaveProperty('readOnly')
    expect(request).not.toHaveProperty('stripWriteTools')
    expect(request.prompt).toEqual([{ type: 'text', text: expect.any(String) }])
  })

  it('prefers a toolFilter-capable start provider', () => {
    expect(pickStartProvider({
      list: () => ['acp', 'spawn'],
      getProvider: (name: string) => ({
        name,
        capabilities: { toolFilter: name === 'spawn' },
      }),
    } as never)).toBe('spawn')
  })

  it('only denies registered write tools', () => {
    expect(judgeToolFilter({
      tools: { schemas: () => [{ name: 'read' }, { name: 'bash' }] },
    } as never)).toEqual({ deny: ['bash'] })
    expect(judgeToolFilter({} as never)).toEqual({ allow: [] })
  })
})
