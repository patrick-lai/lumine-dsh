import { describe, expect, it, vi } from 'vitest'
import { formatSecondOpinionResult, secondOpinionPrompt, tryHostSecondOpinion } from '../src/second-opinion.ts'

describe('host second opinion', () => {
  it('returns undefined when the host has no subagents.start', async () => {
    await expect(tryHostSecondOpinion(undefined, 'brief', {})).resolves.toBeUndefined()
    await expect(tryHostSecondOpinion({}, 'brief', {})).resolves.toBeUndefined()
  })

  it('spawns a listed process provider and frames the result', async () => {
    const start = vi.fn(async () => ({
      result: Promise.resolve({ text: '<<<SECOND_OPINION {"findings":[]}' }),
    }))
    const verdict = await tryHostSecondOpinion({ list: () => ['spawn-in-process'], start }, 'brief', { id: 'parent' })
    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0]?.[0]).toBe('spawn-in-process')
    expect(verdict).toBe('SECOND OPINION · NONE')
  })

  it('formats empty findings and counts', () => {
    expect(formatSecondOpinionResult('<<<SECOND_OPINION {"findings":[]}')).toBe('SECOND OPINION · NONE')
    expect(formatSecondOpinionResult('<<<SECOND_OPINION {"findings":[{"severity":"concern","path":"a.ts","note":"x"}]}'))
      .toMatch(/^SECOND OPINION · 1 findings/)
    expect(secondOpinionPrompt('x')).toMatch(/read-only native reviewer/)
  })
})
