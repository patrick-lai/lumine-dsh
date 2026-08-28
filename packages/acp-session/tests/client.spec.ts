import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AcpChild } from '../src/client.ts'
import { TurnProjector, type LogOp } from '../src/events.ts'

const fakeChild = fileURLToPath(new URL('./fixtures/fake-acp-child.mjs', import.meta.url))

function dummyAgent() {
  return {
    id: 'sess-1',
    session: { header: { cwd: process.cwd() }, events: [], append() { return { seq: 0 } } },
  } as never
}

describe('ACP child + session log (fake official CLI)', () => {
  it('persists a session and maps one prompt onto the DSH turn log', async () => {
    const child = new AcpChild({
      launch: {
        provider: 'cursor',
        command: process.execPath,
        args: [fakeChild],
        env: {},
        unset: [],
        authMethod: 'cursor_login',
        productCommand: 'cursor-agent',
      },
      cwd: process.cwd(),
      permission: 'yolo',
      agent: dummyAgent(),
    })

    const projector = new TurnProjector(1, 1, { provider: 'cursor', model: 'cursor' })
    const log: LogOp[] = [
      ...projector.startTurn({
        id: 'u1',
        role: 'user',
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'user' },
      }),
      ...projector.syntheticHeader('initial'),
    ]
    child.onUpdate = update => {
      log.push(...projector.onUpdate(update))
    }

    try {
      const sessionId = await child.ensure()
      expect(sessionId).toBe('acp-session-1')
      log.push(projector.bind(sessionId))
      const result = await child.prompt([{ type: 'text', text: 'hi' }])
      expect(result.stopReason).toBe('end_turn')
      log.push(...projector.finish('completed'))
    } finally {
      await child.dispose()
    }

    const types = log.map(op => op.type)
    expect(types).toContain('turn/start')
    expect(types).toContain('user/message')
    expect(types).toContain('assistant/chunk')
    expect(types).toContain('tool/call')
    expect(types).toContain('tool/result')
    expect(types).toContain('assistant/message')
    expect(types).toContain('turn/end')
    expect(types.indexOf('turn/start')).toBeLessThan(types.indexOf('user/message'))
    expect(types.indexOf('user/message')).toBeLessThan(types.indexOf('assistant/chunk'))
    expect(types.indexOf('assistant/message')).toBeLessThan(types.indexOf('turn/end'))

    const text = log
      .filter(op => op.type === 'assistant/chunk')
      .map(op => (op.data as { chunk: { type: string; text?: string } }).chunk)
      .filter(chunk => chunk.type === 'text-delta')
      .map(chunk => chunk.text)
      .join('')
    expect(text).toBe('Hello from the fake ACP child.')
  })

  it('yolo-answers permission prompts instead of auto-rejecting', async () => {
    const child = new AcpChild({
      launch: {
        provider: 'claude',
        command: process.execPath,
        args: [fakeChild],
        env: { FAKE_ACP_ASK_PERMISSION: '1' },
        unset: [],
        productCommand: 'claude',
      },
      cwd: process.cwd(),
      permission: 'yolo',
      agent: dummyAgent(),
    })
    const updates: string[] = []
    child.onUpdate = update => {
      if (update.sessionUpdate) updates.push(update.sessionUpdate)
    }
    try {
      await child.ensure()
      const result = await child.prompt([{ type: 'text', text: 'need a tool' }])
      expect(result.stopReason).toBe('end_turn')
      expect(updates).toContain('tool_call_update')
    } finally {
      await child.dispose()
    }
  })
})
