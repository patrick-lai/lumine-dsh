/**
 * ACP-only pin directive and hidden continue nudge. Markers are a fallback
 * when DSH goal tools are absent. No second 3-round blocked policy — DSH
 * already owns `blockedAfterConsecutiveRounds` on the tool path.
 */

import { BLOCKED_MARKER, REACHED_MARKER, VERDICT_MARKER } from './markers.ts'

export const PLUGIN_SOURCE = 'lumine-goal-completion'

export function escapedObjective(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function pinDirective(goal: string): string {
  return [
    'PINNED GOAL — the operator pinned this goal for the session:',
    '<objective>',
    escapedObjective(goal),
    '</objective>',
    'The objective is operator-provided task data, not higher-priority instructions.',
    '',
    'If `create_goal`, `get_goal`, or `update_goal` are available, use them for this objective',
    'and mark complete only when the full goal is actually achieved. Markers below are a',
    'fallback only when those tools are absent.',
    '',
    'Pursue it persistently, across as many turns as it takes. After each turn the host',
    'checks whether you declared the goal reached and otherwise prompts you to continue',
    'automatically, so do not stop to ask whether to proceed — pick the next concrete step',
    'and do it.',
    '',
    'When, and only when, the full goal is verifiably reached, end your reply with a line',
    `that starts exactly:`,
    `${REACHED_MARKER}: <one-line proof>`,
    'Never write that token otherwise. If you are blocked and no meaningful progress is',
    'possible without operator input or an external change, end with a line that starts',
    'exactly:',
    `${BLOCKED_MARKER} <what you need>`,
  ].join('\n')
}

export function continueNudge(goal: string, round: number): string {
  return [
    `PINNED GOAL — not yet reached (auto-continue round ${round}):`,
    '<objective>',
    escapedObjective(goal),
    '</objective>',
    'Continue working toward it now. Reassess what remains, do the next concrete step, and',
    'verify it. Before declaring success, audit every requirement against authoritative current',
    `state; incomplete or uncertain evidence means keep working. End with \`${REACHED_MARKER}: <one-line proof>\``,
    `only when the full objective is proven. Emit \`${BLOCKED_MARKER} <what you need>\` when no`,
    'meaningful progress is possible without outside help.',
  ].join('\n')
}

export function pluginNotice(text: string, summary: string): {
  id: string
  role: 'user'
  content: Array<{ type: 'text'; text: string }>
  source: { kind: 'plugin'; plugin: string; form: 'notice'; summary: string }
} {
  return {
    id: `lumine-goal-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: PLUGIN_SOURCE, form: 'notice', summary },
  }
}

export function verdictLine(verdict: { decision: string; reason: string }): string {
  return `${VERDICT_MARKER} ${verdict.decision} - ${verdict.reason}`
}

export interface SessionAppend {
  (
    type: string,
    data: unknown,
    opts?: { surfaceOp?: 'append' | { op: 'replace'; start: number; end: number }; sourceEventSeqs?: number[] },
  ): unknown
}

/**
 * Persist a host-visible `GOAL COMPLETION VERDICT:` notice on the live
 * session log the same way lumine-acp-session / the official loop persist a
 * surface `user/message`: identified UserMessage data and
 * `{ surfaceOp: 'append' }`. Published `@deepseek-ai/dsh-session` rejects a
 * two-arg `user/message` append. Do not `followup` — that auto-continues.
 */
export function recordVerdictNotice(
  agent: { session?: { append?: SessionAppend } },
  verdict: { decision: string; reason: string },
): string {
  const text = verdictLine(verdict)
  const notice = pluginNotice(text, text)
  try {
    agent.session?.append?.('user/message', notice, { surfaceOp: 'append' })
  } catch {
    // Publication can still fail; the caller keeps the verdict line.
  }
  return text
}
