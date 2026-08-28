/**
 * Line-start harvest markers. A worker `GOAL REACHED` line is a candidate,
 * never authority. Mid-paragraph mentions and instruction-template echoes
 * do not count.
 */

export const REACHED_MARKER = 'GOAL REACHED'
export const BLOCKED_MARKER = 'BLOCKED:'
export const VERDICT_MARKER = 'GOAL COMPLETION VERDICT:'

export type MarkerVerdict =
  | { kind: 'completionCandidate'; proof?: string }
  | { kind: 'blocked'; reason?: string }
  | { kind: 'unresolved' }

const DECORATION = new Set([' ', '\t', '*', '_', '#', '`', '>', '•', '-', '✅', '🎯'])

function trimDecoration(line: string): string {
  let start = 0
  let end = line.length
  while (start < end && DECORATION.has(line[start] ?? '')) start += 1
  while (end > start && DECORATION.has(line[end - 1] ?? '')) end -= 1
  return line.slice(start, end)
}

function trimPayload(raw: string): string {
  return raw.replace(/^[\s\t*_#`>•:\-✅🎯]+/, '').replace(/[\s\t*_#`>•:\-✅🎯]+$/, '')
}

function isTemplateEcho(payload: string): boolean {
  return payload.includes('<')
}

/**
 * Scan a settled assistant reply. Last line-start marker wins.
 * A verbatim echo of the instruction template (`<one-line proof>`) is ignored.
 */
export function scanMarkers(reply: string | undefined): MarkerVerdict {
  if (!reply) return { kind: 'unresolved' }
  for (const rawLine of reply.split(/\r?\n/).toReversed()) {
    const line = trimDecoration(rawLine)
    if (line.startsWith(REACHED_MARKER)) {
      const raw = line.slice(REACHED_MARKER.length)
      if (isTemplateEcho(raw)) continue
      const proof = trimPayload(raw)
      return proof.length === 0
        ? { kind: 'completionCandidate' }
        : { kind: 'completionCandidate', proof }
    }
    if (line.startsWith(BLOCKED_MARKER)) {
      const raw = line.slice(BLOCKED_MARKER.length)
      if (isTemplateEcho(raw)) continue
      const reason = trimPayload(raw)
      return reason.length === 0 ? { kind: 'blocked' } : { kind: 'blocked', reason }
    }
  }
  return { kind: 'unresolved' }
}

export function parseJudgeOutput(output: string): { decision: 'APPROVED' | 'REJECTED' | 'UNVERIFIABLE'; reason: string } | undefined {
  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith(VERDICT_MARKER))
  if (lines.length !== 1) return undefined
  const payload = (lines[0] ?? '').slice(VERDICT_MARKER.length).trim()
  const delimiter = payload.indexOf(' - ')
  if (delimiter < 0) return undefined
  const decision = payload.slice(0, delimiter).trim().toUpperCase()
  const reason = payload.slice(delimiter + 3).trim()
  if (!reason) return undefined
  if (decision === 'APPROVED' || decision === 'REJECTED' || decision === 'UNVERIFIABLE') {
    return { decision, reason }
  }
  return undefined
}
