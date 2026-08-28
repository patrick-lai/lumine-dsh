import { describe, expect, it } from 'vitest'
import { classifyReclaim, isClaimable, reclaimReason, type WorktreeReclaimFacts } from '../src/worktree-reclaim.ts'

const clean: WorktreeReclaimFacts = {
  isAncestorOfMainline: false,
  hasMergedPR: false,
  hasOpenPR: false,
  isPushedToRemote: false,
  hasTrackedChanges: false,
  hasUntrackedFiles: false,
  commitsAhead: 0,
}

describe('worktree reclaim verdict', () => {
  it('lets dirty win over merged proof', () => {
    const facts = { ...clean, isAncestorOfMainline: true, hasTrackedChanges: true }
    expect(classifyReclaim(facts)).toBe('dirty')
    expect(isClaimable('dirty')).toBe(false)
    expect(reclaimReason(facts, 'dirty')).toBe('uncommitted changes')
  })

  it('treats ancestry or a merged PR as merged', () => {
    expect(classifyReclaim({ ...clean, isAncestorOfMainline: true })).toBe('merged')
    expect(classifyReclaim({ ...clean, hasMergedPR: true })).toBe('merged')
    expect(isClaimable('merged')).toBe(true)
  })

  it('allows reclaim when the exact tip is on a remote', () => {
    expect(classifyReclaim({ ...clean, isPushedToRemote: true, commitsAhead: 3 })).toBe('remoteBacked')
    expect(isClaimable('remoteBacked')).toBe(true)
  })

  it('holds in-flight and unlanded work', () => {
    expect(classifyReclaim({ ...clean, hasOpenPR: true, commitsAhead: 2 })).toBe('inFlight')
    expect(classifyReclaim({ ...clean, commitsAhead: 2 })).toBe('unlanded')
    expect(isClaimable('inFlight')).toBe(false)
    expect(isClaimable('unlanded')).toBe(false)
    expect(reclaimReason({ ...clean, commitsAhead: 1 }, 'unlanded'))
      .toBe('1 commit not on the default branch, no PR found')
  })

  it('treats a clean even-with-mainline tree as merged', () => {
    expect(classifyReclaim(clean)).toBe('merged')
  })
})
