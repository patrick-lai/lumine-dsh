/** Plugin configuration (cordis.patch.yml `config`). */
export interface Config {
  /** Judge wall-clock budget. Default 900000 (15 minutes). */
  timeoutMs?: number
  /**
   * When true (default), only an explicit APPROVED verdict may complete.
   * REJECTED, UNVERIFIABLE, timeout, cancel, and a missing judge keep the
   * goal active.
   */
  failClosed?: boolean
  /** Optional judge agent preset / product id (claude, grok, cursor, …). */
  judgePreset?: string
  /**
   * Force the CI / test fake judge (always UNVERIFIABLE unless a `judge`
   * function is also supplied). Implicitly true when `CI=true`.
   */
  fakeJudge?: boolean
  /** Injectable judge. Tests pass a fake; runtime leaves this unset. */
  judge?: JudgeFn
}

export interface ResolvedConfig {
  timeoutMs: number
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

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs must be a positive number')
  }
  const ci = process.env.CI === 'true' || process.env.CI === '1'
  return {
    timeoutMs,
    failClosed: config.failClosed !== false,
    ...config.judgePreset === undefined ? {} : { judgePreset: config.judgePreset },
    fakeJudge: config.fakeJudge === true || (config.judge === undefined && ci),
    ...config.judge === undefined ? {} : { judge: config.judge },
  }
}
