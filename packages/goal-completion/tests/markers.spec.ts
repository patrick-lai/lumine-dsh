import { describe, expect, it } from 'vitest'
import { parseJudgeOutput, scanMarkers } from '../src/markers.ts'
import { isLumineAcpSession } from '../src/session.ts'

describe('marker grammar', () => {
  it('reads line-start GOAL REACHED and ignores mid-line or template echoes', () => {
    expect(scanMarkers('GOAL REACHED: shipped')).toEqual({
      kind: 'completionCandidate',
      proof: 'shipped',
    })
    expect(scanMarkers('I think GOAL REACHED: nope')).toEqual({ kind: 'unresolved' })
    expect(scanMarkers('GOAL REACHED: <one-line proof>')).toEqual({ kind: 'unresolved' })
    expect(scanMarkers('BLOCKED: deploy key')).toEqual({ kind: 'blocked', reason: 'deploy key' })
  })

  it('parses exactly one judge verdict line', () => {
    expect(parseJudgeOutput('GOAL COMPLETION VERDICT: APPROVED - tests pass')).toEqual({
      decision: 'APPROVED',
      reason: 'tests pass',
    })
    expect(parseJudgeOutput('GOAL COMPLETION VERDICT: REJECTED - missing file')).toEqual({
      decision: 'REJECTED',
      reason: 'missing file',
    })
    expect(parseJudgeOutput('no verdict here')).toBeUndefined()
    expect(parseJudgeOutput(
      'GOAL COMPLETION VERDICT: APPROVED - a\nGOAL COMPLETION VERDICT: REJECTED - b',
    )).toBeUndefined()
  })

  it('treats only lumine ACP presets / bound children as ACP sessions', () => {
    expect(isLumineAcpSession({ header: { agentPreset: 'grok-build' } })).toBe(true)
    expect(isLumineAcpSession({
      header: { agentPreset: 'deepseek' },
      events: [{ type: 'request/context', data: { provider: 'deepseek', model: 'deepseek-v4-flash' } }],
    })).toBe(false)
    expect(isLumineAcpSession({
      header: {},
      events: [{ type: 'request/context', data: { acpSessionId: 'acp-9' } }],
    })).toBe(true)
  })
})
