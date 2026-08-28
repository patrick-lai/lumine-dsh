import { describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { createRuntimeJudge, judgeToolFilter, pickStartProvider, START_DID_NOT_SETTLE } from '../src/judge.ts'
import { lastAssistantReply } from '../src/session.ts'
import { acpChunkLog, assistantMessage, makeAgent, makeSession, turnEnd } from './helpers.ts'

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

  it('does not treat CI=true as an implicit fake judge', () => {
    const previous = process.env.CI
    process.env.CI = 'true'
    try {
      const resolved = resolveConfig({ timeoutMs: 1_000 })
      expect(resolved.fakeJudge).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.CI
      else process.env.CI = previous
    }
  })

  it('resolves subagents.start via ctx.get when ctx.subagents is unset', async () => {
    const parent = makeAgent(makeSession())
    const start = vi.fn(async () => ({
      result: Promise.resolve({
        output: [{ type: 'text', text: 'GOAL COMPLETION VERDICT: APPROVED - via get' }],
        stopReason: 'completed',
      }),
      dispose: vi.fn(),
    }))
    const judge = createRuntimeJudge({
      logger: { warn() {}, info() {}, error() {} },
      get: (name: string) => name === 'subagents'
        ? { start, list: () => ['spawn'], getProvider: () => ({ name: 'spawn', capabilities: { toolFilter: true } }) }
        : undefined,
    } as never, {
      timeoutMs: 1_000,
      failClosed: true,
      fakeJudge: false,
    })
    const verdict = await judge({
      goalId: 'goal-1',
      revision: 1,
      objective: 'x',
      reply: 'GOAL REACHED: y',
      parent,
    }, new AbortController().signal)
    expect(start).toHaveBeenCalledOnce()
    expect(verdict).toEqual({ decision: 'APPROVED', reason: 'via get' })
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
    expect(verdict.reason).toBe('NO_PROVIDER')
    expect(warn).toHaveBeenCalled()
  })

  it('surfaces a truncated start() error instead of a catch-all', async () => {
    const long = `NO_PROVIDER: provider "acp" is not registered ${'x'.repeat(300)}`
    const judge = createRuntimeJudge({
      logger: { warn() {}, info() {}, error() {} },
      subagents: {
        start: async () => {
          throw new Error(long)
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
    expect(verdict.reason).toMatch(/^NO_PROVIDER: provider "acp" is not registered/)
    expect(verdict.reason).not.toMatch(/did not finish/)
    expect(verdict.reason.endsWith('…')).toBe(true)
    expect(verdict.reason.length).toBeLessThanOrEqual(241)
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

  it('does not prefer acp on a lumine ACP / grok-build parent when spawn is listed', () => {
    expect(pickStartProvider({
      list: () => ['spawn', 'acp'],
      getProvider: (name: string) => ({
        name,
        capabilities: { toolFilter: name === 'spawn' },
      }),
    } as never, makeAgent(makeSession()))).toBe('spawn')
  })

  it('does not start acp when list() is empty and getProvider("acp") is a stub', async () => {
    const start = vi.fn(async () => {
      throw new Error('should not start')
    })
    const judge = createRuntimeJudge({
      logger: { warn() {}, info() {}, error() {} },
      subagents: {
        start,
        list: () => [],
        getProvider: (name: string) => name === 'acp' ? { name: 'acp' } : undefined,
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
      reply: 'GOAL REACHED: pong',
      parent: makeAgent(makeSession()),
    }, new AbortController().signal)
    expect(start).not.toHaveBeenCalled()
    expect(verdict).toEqual({ decision: 'UNVERIFIABLE', reason: 'no subagent provider is registered' })
  })

  it('starts spawn on a grok-build parent when spawn is the live provider', async () => {
    const start = vi.fn(async () => ({
      result: Promise.resolve({
        output: [{ type: 'text', text: 'GOAL COMPLETION VERDICT: APPROVED - file is exactly pong' }],
        stopReason: 'completed',
      }),
      dispose: vi.fn(),
    }))
    const judge = createRuntimeJudge({
      logger: { warn() {}, info() {}, error() {} },
      tools: { schemas: () => [{ name: 'read' }, { name: 'bash' }] },
      subagents: {
        start,
        list: () => ['spawn'],
        getProvider: (name: string) => ({
          name,
          capabilities: { toolFilter: name === 'spawn', agentOptions: false },
        }),
      },
    } as never, {
      timeoutMs: 1_000,
      failClosed: true,
      fakeJudge: false,
    })
    const verdict = await judge({
      goalId: 'goal-1',
      revision: 1,
      objective: 'file is exactly pong',
      reply: 'GOAL REACHED: file is exactly pong',
      parent: makeAgent(makeSession()),
    }, new AbortController().signal)
    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0]?.[0]).toBe('spawn')
    const request = start.mock.calls[0]?.[1] as { toolFilter?: unknown; agentOptions?: unknown }
    expect(request.toolFilter).toEqual({ deny: ['bash'] })
    expect(request.agentOptions).toBeUndefined()
    expect(verdict).toEqual({ decision: 'APPROVED', reason: 'file is exactly pong' })
  })

  it('does not pass toolFilter to a provider that advertises toolFilter: false', async () => {
    const start = vi.fn(async () => ({
      result: Promise.resolve({
        output: [{ type: 'text', text: 'GOAL COMPLETION VERDICT: REJECTED - missing pong' }],
        stopReason: 'completed',
      }),
      dispose: vi.fn(),
    }))
    const judge = createRuntimeJudge({
      logger: { warn() {}, info() {}, error() {} },
      tools: { schemas: () => [{ name: 'read' }, { name: 'bash' }] },
      subagents: {
        start,
        list: () => ['acp'],
        getProvider: () => ({ name: 'acp', capabilities: { toolFilter: false, agentOptions: false } }),
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
    expect(start.mock.calls[0]?.[0]).toBe('acp')
    expect(start.mock.calls[0]?.[1]).not.toHaveProperty('toolFilter')
  })

  it('fail-closes UNVERIFIABLE with diagnostic when run.result stopReason is error', async () => {
    const dispose = vi.fn()
    const judge = createRuntimeJudge({
      logger: { warn() {}, info() {}, error() {} },
      subagents: {
        start: async () => ({
          result: Promise.resolve({
            output: [],
            stopReason: 'error',
            diagnostic: 'spawn cannot nest under this ACP parent',
          }),
          dispose,
        }),
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
    expect(verdict).toEqual({
      decision: 'UNVERIFIABLE',
      reason: 'spawn cannot nest under this ACP parent',
    })
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('does not invent spawn when no provider is registered', async () => {
    const start = vi.fn(async () => {
      throw new Error('should not start')
    })
    const judge = createRuntimeJudge({
      logger: { warn() {}, info() {}, error() {} },
      subagents: { start, list: () => [] },
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
    expect(start).not.toHaveBeenCalled()
    expect(verdict).toEqual({ decision: 'UNVERIFIABLE', reason: 'no subagent provider is registered' })
  })

  it('hung start() fail-closes UNVERIFIABLE without waiting for the 15-minute abort', async () => {
    const start = vi.fn(() => new Promise(() => {}))
    const judge = createRuntimeJudge({
      logger: { warn() {}, info() {}, error() {} },
      subagents: {
        start,
        list: () => ['spawn'],
        getProvider: () => ({ name: 'spawn', capabilities: { toolFilter: true } }),
      },
    } as never, {
      timeoutMs: 1_000,
      startTimeoutMs: 25,
      failClosed: true,
      fakeJudge: false,
    })
    const verdict = await judge({
      goalId: 'goal-1',
      revision: 1,
      objective: 'x',
      reply: 'GOAL REACHED: pong',
      parent: makeAgent(makeSession()),
    }, new AbortController().signal)
    expect(start).toHaveBeenCalledOnce()
    expect(verdict).toEqual({ decision: 'UNVERIFIABLE', reason: START_DID_NOT_SETTLE })
  })

  it('only denies registered write tools', () => {
    expect(judgeToolFilter({
      tools: { schemas: () => [{ name: 'read' }, { name: 'bash' }] },
    } as never)).toEqual({ deny: ['bash'] })
    expect(judgeToolFilter({} as never)).toEqual({ allow: [] })
  })
})

describe('lastAssistantReply on published ACP logs', () => {
  it('reads assistant/message { turn, step, message } text blocks', () => {
    const session = makeSession([
      assistantMessage('Work done.\nGOAL REACHED: shipped'),
      turnEnd('completed'),
    ])
    expect(lastAssistantReply(session)).toBe('Work done.\nGOAL REACHED: shipped')
    expect(lastAssistantReply(session.events)).toContain('GOAL REACHED')
  })

  it('folds assistant/chunk text-deltas when the message content is empty', () => {
    expect(lastAssistantReply(makeSession(acpChunkLog('GOAL REACHED: file is exactly pong')))).toBe(
      'GOAL REACHED: file is exactly pong',
    )
  })
})
