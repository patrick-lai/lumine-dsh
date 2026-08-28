/**
 * Host-loop turn numbering and visible driver failures.
 *
 * Official dsh-agent-loop: running phase stores `turn` (last completed),
 * next turn is `phase.turn + 1`, `turn/start` is appended *before* Inbox.claim.
 * A running phase has no `lastTurn`. `phase.lastTurn + 1` is NaN and
 * `session.append('turn/start', { turn: NaN })` is rejected — the live miss
 * after claim with no turn/start.
 */

export function nextTurnOf(phaseTurn: number): number {
  if (!Number.isSafeInteger(phaseTurn) || phaseTurn < 0) {
    throw new Error(`lumine-acp-session: invalid running phase.turn (${String(phaseTurn)})`)
  }
  return phaseTurn + 1
}

export function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...error.stack === undefined ? {} : { stack: error.stack },
    }
  }
  return { message: String(error) }
}

export function formatDriverFailure(where: string, error: unknown): string {
  const { message, stack } = describeError(error)
  return stack
    ? `lumine-acp-session: ${where}: ${message}\n${stack}`
    : `lumine-acp-session: ${where}: ${message}`
}

/** Host order: persist turn/start, then claim that turn's inbox batch. */
export function openTurnThenClaim<T>(
  appendTurnStart: (turn: number) => void,
  claim: (turn: number) => T[],
  turn: number,
): T[] {
  appendTurnStart(turn)
  return claim(turn)
}
