import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TurnProjector } from '../src/events.ts'
import {
  describeError,
  formatDriverFailure,
  nextTurnOf,
  openTurnThenClaim,
} from '../src/turn.ts'

describe('host-loop turn order (claim after turn/start)', () => {
  it('uses running phase.turn + 1, not lastTurn (NaN on a running phase)', () => {
    const running = { kind: 'running' as const, turn: 0, step: 0, wakeRequested: false }
    expect(nextTurnOf(running.turn)).toBe(1)
    expect(Number.isNaN((running as { lastTurn?: number }).lastTurn! + 1)).toBe(true)
    expect(() => nextTurnOf(Number.NaN)).toThrow(/invalid running phase\.turn/)
  })

  it('appends turn/start before Inbox.claim, matching dsh-agent-loop', () => {
    const log: string[] = []
    const claimed = openTurnThenClaim(
      turn => { log.push(`turn/start:${turn}`) },
      turn => {
        log.push(`claim:${turn}`)
        return [{ id: 'u1', text: 'Reply with the single word pong' }]
      },
      1,
    )
    expect(log).toEqual(['turn/start:1', 'claim:1'])
    expect(claimed).toHaveLength(1)
  })

  it('projector splits openTurn and enterStep so claim can sit between them', () => {
    const projector = new TurnProjector(1, 1, { provider: 'grok', model: 'grok-4.6' })
    expect(projector.openTurn().map(op => op.type)).toEqual(['turn/start'])
    expect(projector.enterStep({
      id: 'u1',
      role: 'user',
      content: [{ type: 'text', text: 'pong' }],
      source: { kind: 'user' },
    }).map(op => op.type)).toEqual(['user/message', 'step/start'])
    expect(projector.closeTurn('error', { message: 'visible', code: 'ACP_TURN' })[0]).toEqual({
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'error', error: { message: 'visible', code: 'ACP_TURN' } } },
    })
  })

  it('formats kick/turn failures with stack so the next E2E cannot hide them', () => {
    const error = new Error('turn/start expected turn 1, got NaN')
    const described = describeError(error)
    expect(described.message).toContain('NaN')
    expect(described.stack).toMatch(/Error: turn\/start expected turn 1, got NaN/)
    expect(formatDriverFailure('kick', error)).toMatch(
      /lumine-acp-session: kick: turn\/start expected turn 1, got NaN\nError:/,
    )
  })

  it('treats NaN turn payloads as non-JSON, and writes a JSON-safe feedback/record', async () => {
    const { driverErrorRecord, isJsonSafe } = await import('../src/turn.ts')
    expect(isJsonSafe({ turn: 1 })).toBe(true)
    expect(isJsonSafe({ turn: Number.NaN })).toBe(false)
    expect(isJsonSafe({ turn: Number.POSITIVE_INFINITY })).toBe(false)
    const record = driverErrorRecord('kick', new Error('session event "turn/start" carries non-JSON-serializable data'))
    expect(isJsonSafe(record)).toBe(true)
    expect(record).toEqual({
      text: 'lumine-acp-session: kick: session event "turn/start" carries non-JSON-serializable data',
    })
  })
})

describe('AcpSessionAgent driver contract', () => {
  const source = readFileSync(new URL('../src/agent.ts', import.meta.url), 'utf8')

  it('opens the turn from phase.turn, claims after turn/start, and never swallows kick errors', () => {
    expect(source).toMatch(/nextTurnOf\(phase\.turn\)/)
    expect(source).not.toMatch(/phase\.lastTurn \+ 1/)
    expect(source).toMatch(/openTurnThenClaim/)
    expect(source).toMatch(/inserted: \(\) => \{ this\.wakeDriver\(\)/)
    expect(source).toMatch(/reportDriverFailure\('kick'/)
    expect(source).toMatch(/logger\.error/)
    expect(source).toMatch(/feedback\/record/)
    expect(source).toMatch(/hostServesProvider/)
    expect(source).toMatch(/catalogRoute/)
    expect(source).not.toMatch(/catch \{\s*\/\/ Failures are written/)
  })
})

describe('inbox inserted wakes the driver', () => {
  it('treats a host splice insert as a wake (followup already wakes; belt and suspenders)', () => {
    const wakes: string[] = []
    const notifications = {
      inserted: () => { wakes.push('wake') },
      discarded: () => {},
      claimed: () => {},
    }
    notifications.inserted()
    expect(wakes).toEqual(['wake'])
  })
})
