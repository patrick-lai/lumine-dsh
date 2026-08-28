import { describe, expect, it } from 'vitest'
import { buildSessionEventsPayload } from '../src/payloads.ts'
import { scrubSecrets } from '../src/scrub.ts'

describe('host secret scrub', () => {
  it('redacts tokens, keys, and bearer headers', () => {
    const raw = [
      'authorization: Bearer supersecrettokenvalue',
      'ghp_abcdefghijklmnopqrstuvwxyz123456',
      'AKIAIOSFODNN7EXAMPLE',
      'api_key=sk-live-abcdefghijklmnopqrstuvwxyz',
      'xoxb-1234567890-abcdefgh',
    ].join('\n')
    const scrubbed = scrubSecrets(raw)
    expect(scrubbed).not.toMatch(/ghp_/)
    expect(scrubbed).not.toMatch(/AKIA/)
    expect(scrubbed).not.toMatch(/sk-live/)
    expect(scrubbed).not.toMatch(/xoxb-/)
    expect(scrubbed).toMatch(/\[redacted/)
  })

  it('scrubs secrets before they leave on the session-events wire', () => {
    const payload = buildSessionEventsPayload({
      sourceSessionId: 's',
      workspaceId: 'ws_local',
      settledAt: '2026-08-28T09:30:00Z',
      digest: 'token=ghp_abcdefghijklmnopqrstuvwxyz123456',
      tail: 'authorization: secret-value',
      receipt: { result: 'failed', label: 'failed', recall_ids: [] },
    })
    const event = (payload.events as Array<{ content: Array<{ text: string }> }>)[0]
    const text = event?.content[0]?.text ?? ''
    expect(text).not.toContain('ghp_')
    expect(text).not.toContain('secret-value')
    expect(text).toContain('[redacted')
  })
})
