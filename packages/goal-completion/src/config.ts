/** Plugin configuration (cordis.patch.yml `config`). */
export interface Config {
  /** Judge wall-clock budget. Default 900000 (15 minutes). */
  timeoutMs?: number
  /**
   * How long `subagents.start()` may sit without returning a run.
   * Hung start() ignores the 15-minute abort signal; this watchdog
   * fail-closes UNVERIFIABLE so `state.judging` cannot stick. Default 30000.
   */
  startTimeoutMs?: number
  /**
   * When true (default), only an explicit APPROVED verdict may complete.
   * REJECTED, UNVERIFIABLE, timeout, cancel, and a missing judge keep the
   * goal active.
   */
  failClosed?: boolean
  /** Optional judge agent preset / product id (claude, grok, cursor, …). */
  judgePreset?: string
  /**
   * Force the test fake judge (always UNVERIFIABLE unless a `judge`
   * function is also supplied). Tests must set this explicitly — never
   * inferred from `CI=true`, or a live box with CI set would never call
   * `subagents.start` and would harvest-nudge forever.
   */
  fakeJudge?: boolean
  /** Injectable judge. Tests pass a fake; runtime leaves this unset. */
  judge?: JudgeFn
}

export interface ResolvedConfig {
  timeoutMs: number
  startTimeoutMs: number
  failClosed: boolean
  judgePreset?: string
  fakeJudge: boolean
  judge?: JudgeFn
}

export interface CompletionCandidate {
  readonly goalId: string
  readonly revision: number
  readonly objective: string
  readonly reply: string
  readonly proof?: string
  /** Spawning worker. Runtime `subagents.start` requires this as `parent`. */
  readonly parent?: import('@deepseek-ai/dsh-agent').Agent
}

export type VerdictDecision = 'APPROVED' | 'REJECTED' | 'UNVERIFIABLE'

export interface Verdict {
  readonly decision: VerdictDecision
  readonly reason: string
}

export type JudgeFn = (candidate: CompletionCandidate, signal: AbortSignal) => Promise<Verdict>

export const DEFAULT_TIMEOUT_MS = 900_000
export const DEFAULT_START_TIMEOUT_MS = 30_000

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs must be a positive number')
  }
  const startTimeoutMs = config.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
  if (!Number.isFinite(startTimeoutMs) || startTimeoutMs <= 0) {
    throw new TypeError('startTimeoutMs must be a positive number')
  }
  return {
    timeoutMs,
    startTimeoutMs,
    failClosed: config.failClosed !== false,
    ...config.judgePreset === undefined ? {} : { judgePreset: config.judgePreset },
    fakeJudge: config.fakeJudge === true,
    ...config.judge === undefined ? {} : { judge: config.judge },
  }
}
