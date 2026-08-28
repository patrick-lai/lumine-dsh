import { describe, expect, it, vi } from 'vitest'
import { decidePermission } from '../src/permission.ts'

const options = [
  { optionId: 'allow-always', kind: 'allow_always' },
  { optionId: 'allow-once', kind: 'allow_once' },
  { optionId: 'reject-once', kind: 'reject_once' },
]

const params = {
  toolCall: { toolCallId: 'c1', title: 'bash', kind: 'execute' },
  options,
}

describe('permission policy', () => {
  it('yolo selects allow_always', async () => {
    const decision = await decidePermission(params, {
      mode: 'yolo',
      agent: {} as never,
    })
    expect(decision).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-always' } })
  })

  it('ask maps allowed-once / rejected / unavailable (unavailable still allows)', async () => {
    const approval = { request: vi.fn() }
    approval.request.mockResolvedValueOnce('allowed-once')
    expect(await decidePermission(params, { mode: 'ask', agent: {} as never, approval }))
      .toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } })

    approval.request.mockResolvedValueOnce('rejected')
    expect(await decidePermission(params, { mode: 'ask', agent: {} as never, approval }))
      .toEqual({ outcome: { outcome: 'selected', optionId: 'reject-once' } })

    approval.request.mockResolvedValueOnce('unavailable')
    expect(await decidePermission(params, { mode: 'ask', agent: {} as never, approval }))
      .toEqual({ outcome: { outcome: 'selected', optionId: 'allow-always' } })
  })

  it('does not auto-reject when no approval service is composed', async () => {
    const decision = await decidePermission(params, { mode: 'ask', agent: {} as never })
    expect(decision.outcome).toEqual({ outcome: 'selected', optionId: 'allow-always' })
  })
})
