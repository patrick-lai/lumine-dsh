/**
 * Compact identity for one (goal, revision, reply) so a stale judge cannot
 * land after pause / clear / edit. Not a trust boundary.
 */

const FNV_OFFSET = 14_695_981_039_346_656_037n
const FNV_PRIME = 1_099_511_628_211n

export interface IdentityFence {
  readonly goalId: string
  readonly revision: number
  readonly fingerprint: string
}

export function replyFingerprint(reply: string): string {
  let hash = FNV_OFFSET
  const bytes = new TextEncoder().encode(reply)
  for (const byte of bytes) {
    hash = (hash ^ BigInt(byte)) * FNV_PRIME
    hash &= 0xFFFF_FFFF_FFFF_FFFFn
  }
  return hash.toString(16)
}

export function identityFence(goalId: string, revision: number, reply: string): IdentityFence {
  return { goalId, revision, fingerprint: replyFingerprint(reply) }
}

export function sameFence(left: IdentityFence, right: IdentityFence): boolean {
  return left.goalId === right.goalId
    && left.revision === right.revision
    && left.fingerprint === right.fingerprint
}
