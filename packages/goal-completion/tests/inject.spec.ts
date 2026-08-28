import { describe, expect, it, vi } from 'vitest'
import { apply, HARVEST_INJECT, inject, START_CALLER_INJECT, TOOLS_WRAP_INJECT } from '../src/plugin.ts'
import { acpLog, makeAgent, makeGoal, makeSession } from './helpers.ts'

describe('production apply() inject shape', () => {
  it('lists goals, subagents, tools, and systemPrompt (dsh-tool-subagent caller set + goals)', () => {
    expect(inject).toContain('goals')
    expect(inject).toContain('subagents')
    expect(inject).toContain('tools')
    expect(inject).toContain('systemPrompt')
    expect(inject).toEqual(['goals', 'subagents', 'tools', 'systemPrompt'])
    expect([...START_CALLER_INJECT]).toEqual(inject)
  })

  it('a plugin ctx without inject([subagents, systemPrompt]) is not the production apply() shape', () => {
    const missingSubagents = ['goals']
    const missingSystemPrompt = ['goals', 'subagents', 'tools']
    expect(missingSubagents.includes('subagents')).toBe(false)
    expect(missingSystemPrompt.includes('systemPrompt')).toBe(false)
    expect(inject.includes('subagents')).toBe(true)
    expect(inject.includes('systemPrompt')).toBe(true)
    expect(inject).not.toEqual(missingSubagents)
    expect(inject).not.toEqual(missingSystemPrompt)
  })

  it('does not kitchen-sink agents, sessions, or agentPresets on apply() inject', () => {
    expect(inject).not.toContain('agents')
    expect(inject).not.toContain('sessions')
    expect(inject).not.toContain('agentPresets')
  })

  it('widens nested harvest/tools injects because Cordis nested inject is exclusive', () => {
    expect([...HARVEST_INJECT]).toEqual(['agents', 'goals', 'subagents', 'tools', 'systemPrompt'])
    expect([...TOOLS_WRAP_INJECT]).toEqual(['tools', 'goals', 'subagents', 'systemPrompt'])
    expect(HARVEST_INJECT).toContain('agents')
    expect(HARVEST_INJECT).toContain('systemPrompt')
    expect(HARVEST_INJECT).toContain('subagents')
    expect(TOOLS_WRAP_INJECT).toContain('systemPrompt')
    expect(TOOLS_WRAP_INJECT).toContain('subagents')
  })

  it('apply() on a grok-build parent with injected subagents calls start()', async () => {
    const goal = makeGoal()
    const session = makeSession(acpLog('GOAL REACHED: file is exactly pong'))
    const agent = makeAgent(session)
    const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
    const start = vi.fn(async () => ({
      result: Promise.resolve({
        output: [{ type: 'text', text: 'GOAL COMPLETION VERDICT: APPROVED - file is exactly pong' }],
        stopReason: 'completed',
      }),
      dispose: vi.fn(),
    }))
    const complete = vi.fn((nextAgent, ref) => {
      goal.phase = 'complete'
      return { ...goal, ...ref, phase: 'complete' as const }
    })
    const injectCalls: string[][] = []
    const ctx = {
      logger: { warn() {}, info() {}, error() {} },
      goals: { get: () => goal, complete, block: vi.fn(), disarm: vi.fn() },
      agents: { get: () => agent },
      tools: { schemas: () => [{ name: 'read' }] },
      subagents: {
        start,
        list: () => ['spawn'],
        getProvider: (name: string) => ({ name, capabilities: { toolFilter: name === 'spawn' } }),
      },
      inject(deps: string[], callback: (inner: typeof ctx) => void) {
        injectCalls.push([...deps])
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
    expect(injectCalls).toContainEqual([...TOOLS_WRAP_INJECT])
    expect(injectCalls).toContainEqual([...HARVEST_INJECT])
    expect(injectCalls.some(deps => deps.length === 1 && deps[0] === 'agents')).toBe(false)
    expect(injectCalls.some(deps => deps.length === 1 && deps[0] === 'tools')).toBe(false)
    for (const listener of listeners.get('session/event') ?? []) {
      await listener(session, session.events.find(event => event.type === 'turn/end'))
    }
    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0]?.[0]).toBe('spawn')
    expect(complete).toHaveBeenCalledOnce()
    expect(goal.phase).toBe('complete')
  })
})
