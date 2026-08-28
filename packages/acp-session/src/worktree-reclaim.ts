/**
 * Raphael reclaim policy: a pooled tree is claimable only when its committed
 * work is proven durable (merged into mainline, or the exact tip is on a remote)
 * AND the checkout is clean. Dirty / unlanded / in-flight trees are never reset.
 */

export type WorktreeReclaimVerdict =
  | 'merged'
  | 'remoteBacked'
  | 'inFlight'
  | 'unlanded'
  | 'dirty'

export interface WorktreeReclaimFacts {
  isAncestorOfMainline: boolean
  hasMergedPR: boolean
  hasOpenPR: boolean
  isPushedToRemote: boolean
  hasTrackedChanges: boolean
  hasUntrackedFiles: boolean
  commitsAhead: number
}

export function classifyReclaim(facts: WorktreeReclaimFacts): WorktreeReclaimVerdict {
  if (facts.hasTrackedChanges || facts.hasUntrackedFiles) return 'dirty'
  if (facts.isAncestorOfMainline || facts.hasMergedPR) return 'merged'
  if (facts.isPushedToRemote) return 'remoteBacked'
  if (facts.hasOpenPR) return 'inFlight'
  if (facts.commitsAhead > 0) return 'unlanded'
  return 'merged'
}

export function isClaimable(verdict: WorktreeReclaimVerdict): boolean {
  return verdict === 'merged' || verdict === 'remoteBacked'
}

export function reclaimReason(facts: WorktreeReclaimFacts, verdict: WorktreeReclaimVerdict): string {
  switch (verdict) {
    case 'merged':
      if (facts.hasMergedPR) return 'PR merged'
      if (facts.isAncestorOfMainline) return 'merged into the default branch'
      return 'even with the default branch'
    case 'remoteBacked':
      return 'committed and pushed; awaiting merge'
    case 'inFlight':
      return 'open PR under review'
    case 'unlanded': {
      const n = facts.commitsAhead
      return `${n} commit${n === 1 ? '' : 's'} not on the default branch, no PR found`
    }
    case 'dirty': {
      const parts: string[] = []
      if (facts.hasTrackedChanges) parts.push('uncommitted changes')
      if (facts.hasUntrackedFiles) parts.push('untracked files')
      return parts.join(' + ')
    }
  }
}
