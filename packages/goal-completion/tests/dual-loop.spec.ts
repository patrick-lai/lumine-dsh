import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/plugin.ts'
import { createAcpFallback } from '../src/acp-fallback.ts'
import { createCertifier } from '../src/certifier.ts'
import { fakeJudge } from '../src/judge.ts'
import {
  agentScopedRoundDriverEnabled,
  canMountAcpFallback,
  hasRoundDriver,
} from '../src/session.ts'
import { acpLog, makeAgent, makeGoal, makeSession, nativeLog, sessionNoticeTexts } from './helpers.ts'

const GROK_PRESET = readFileSync(new URL('../../acp-session/presets/grok-build/agent.cordis.yml', import.meta.url), 'utf8')

describe('ACP harvest mounts instead of the goal-round-driver on lumine presets', () => {
  it('grok-build preset disables the driver so harvest can mount', () => {
    expect(GROK_PRESET).toMatch(/id:\s*goal-round-driver/)
    expect(GROK_PRESET).toMatch(/disabled:\s*true/)
    expect(GROK_PRESET).not.toMatch(/^\[\]\s*$/m)
  })

  it('refuses the marker loop only when THIS session mounted the driver', () => {
    expect(canMountAcpFallback({ sessionIsLumineAcp: true, roundDriverPresent: true })).toBe(false)
    expect(canMountAcpFallback({ sessionIsLumineAcp: true, roundDriverPresent: false })).toBe(true)
    expect(canMountAcpFallback({ sessionIsLumineAcp: false, roundDriverPresent: false })).toBe(false)
  })

  it('detects the official driver plugin id on a host registry (id helper only)', () => {
    expect(hasRoundDriver({ registry: new Map([['goal-round-driver', {}]]) })).toBe(true)
    expect(hasRoundDriver({ registry: new Map([['@deepseek-ai/dsh-goal-round-driver', {}]]) })).toBe(true)
    expect(hasRoundDriver({ registry: new Map([['lumine-acp-session', {}]]) })).toBe(false)
  })

  it('ignores a host-plane registry when deciding the agent-scoped driver', () => {
    expect(agentScopedRoundDriverEnabled({
      fiber: { children: [] },
      runtime: { name: 'lumine-goal-completion' },
    })).toBe(false)
    expect(agentScopedRoundDriverEnabled({
      fiber: { children: [{ name: 'goal-round-driver' }] },
    })).toBe(true)
    expect(agentScopedRoundDriverEnabled({
      fiber: { children: [{ name: 'goal-round-driver', disabled: true }] },
    })).toBe(false)
  })

  it('does not nudge or complete when the session itself mounted the driver', async () => {
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

  it('apply() on grok-build mounts harvest even when the host registry has the driver', async () => {
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
        disarm: vi.fn(),
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
    expect(followups.length).toBeGreaterThan(0)
    expect(String((followups[0] as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? '')).toContain(
      'PINNED GOAL — not yet reached',
    )
    expect(ctx.goals.complete).not.toHaveBeenCalled()
  })

  it('apply() on grok-build pins PINNED GOAL on create and certifies GOAL REACHED', async () => {
    const goal = makeGoal()
    const followups: unknown[] = []
    const session = makeSession(acpLog('Wrote pong.\nGOAL REACHED: file is exactly pong'))
    const agent = makeAgent(session, followups)
    const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
    const complete = vi.fn((nextAgent, ref) => {
      goal.phase = 'complete'
      return { ...goal, ...ref, phase: 'complete' as const }
    })
    const ctx = {
      logger: { warn() {}, info() {}, error() {} },
      goals: {
        get: () => goal,
        complete,
        block: vi.fn(),
        disarm: vi.fn(() => {
          goal.activation = 'disarmed'
          return goal
        }),
      },
      agents: { get: () => agent },
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
    apply(ctx as never, { judge: fakeJudge('APPROVED', 'file is exactly pong'), timeoutMs: 50 })

    for (const listener of listeners.get('goal/changed') ?? []) {
      listener({ agent, operation: 'create' })
    }
    expect(followups.some(item => String((item as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? '').includes('PINNED GOAL'))).toBe(true)
    expect(ctx.goals.disarm).toHaveBeenCalledOnce()

    for (const listener of listeners.get('session/event') ?? []) {
      await listener(session, session.events.find(event => event.type === 'turn/end'))
    }
    expect(complete).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledWith(agent, { id: 'goal-1', revision: 1 })
    expect(goal.phase).toBe('complete')
    expect(sessionNoticeTexts(session)).toContain('GOAL COMPLETION VERDICT: APPROVED - file is exactly pong')
  })

  it('apply() on a settled ACP log with GOAL REACHED calls start() and records a verdict notice', async () => {
    const goal = makeGoal()
    const followups: Array<{ content?: Array<{ text?: string }> }> = []
    const session = makeSession(acpLog('Wrote pong.\nGOAL REACHED: file is exactly pong'))
    const agent = makeAgent(session, followups)
    const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
    const complete = vi.fn((nextAgent, ref) => {
      goal.phase = 'complete'
      return { ...goal, ...ref, phase: 'complete' as const }
    })
    const start = vi.fn(async (_name: string, request: {
      prompt: Array<{ type: string; text?: string }>
      parent: unknown
      signal: AbortSignal
    }) => {
      expect(request.parent).toBe(agent)
      expect(request.prompt[0]?.text).toContain('ORIGINAL OBJECTIVE')
      return {
        result: Promise.resolve({
          output: [{ type: 'text', text: 'GOAL COMPLETION VERDICT: APPROVED - file is exactly pong' }],
          stopReason: 'completed',
        }),
        dispose: vi.fn(),
      }
    })
    const ctx = {
      logger: { warn() {}, info() {}, error() {} },
      goals: {
        get: () => goal,
        complete,
        block: vi.fn(),
        disarm: vi.fn(),
      },
      agents: { get: () => agent },
      subagents: {
        start,
        list: () => ['spawn'],
        getProvider: () => ({ name: 'spawn', capabilities: { toolFilter: true } }),
      },
      get(name: string) {
        return name === 'subagents' ? this.subagents : undefined
      },
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
    apply(ctx as never, { fakeJudge: false, timeoutMs: 50 })

    for (const listener of listeners.get('session/event') ?? []) {
      await listener(session, session.events.find(event => event.type === 'assistant/message'))
      await listener(session, session.events.find(event => event.type === 'turn/end'))
    }
    expect(start).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledWith(agent, { id: 'goal-1', revision: 1 })
    expect(sessionNoticeTexts(session)).toContain('GOAL COMPLETION VERDICT: APPROVED - file is exactly pong')
    expect(followups.some(item => String(item.content?.[0]?.text ?? '').includes('auto-continue'))).toBe(false)
  })

  it('apply() missing start() emits UNVERIFIABLE and does not harvest-nudge', async () => {
    const goal = makeGoal()
    const followups: Array<{ content?: Array<{ text?: string }> }> = []
    const session = makeSession(acpLog('GOAL REACHED: file is exactly pong'))
    const agent = makeAgent(session, followups)
    const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
    const complete = vi.fn()
    const ctx = {
      logger: { warn() {}, info() {}, error() {} },
      goals: {
        get: () => goal,
        complete,
        block: vi.fn(),
        disarm: vi.fn(),
      },
      agents: { get: () => agent },
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
    apply(ctx as never, { fakeJudge: false, timeoutMs: 50 })
    for (const listener of listeners.get('session/event') ?? []) {
      await listener(session, session.events.find(event => event.type === 'turn/end'))
    }
    expect(complete).not.toHaveBeenCalled()
    expect(sessionNoticeTexts(session)).toContain('GOAL COMPLETION VERDICT: UNVERIFIABLE - no read-only judge is available')
    expect(followups).toHaveLength(0)
    expect(goal.phase).toBe('active')
  })

  it('apply() does not harvest markers on a DeepSeek-native session', async () => {
    const followups: unknown[] = []
    const session = makeSession(nativeLog('GOAL REACHED: native should not harvest'), 'standard')
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
    apply(ctx as never, { judge: fakeJudge('APPROVED', 'unused'), timeoutMs: 50 })
    for (const listener of listeners.get('session/event') ?? []) {
      await listener(session, session.events.find(event => event.type === 'turn/end'))
    }
    expect(followups).toHaveLength(0)
    expect(ctx.goals.complete).not.toHaveBeenCalled()
  })
})
