/**
 * Worker completion gate. A candidate is certified by an isolated judge;
 * only APPROVED may call `ctx.goals.complete`. Operator `/goal` and RPC
 * `goal.complete` never enter this gate.
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JudgeFn, Verdict } from './config.ts'
import { identityFence, sameFence, type IdentityFence } from './fingerprint.ts'

export interface GoalRef {
  readonly id: string
  readonly revision: number
}

export interface GoalView {
  readonly id: string
  readonly revision: number
  readonly objective: string
  readonly phase: 'active' | 'paused' | 'blocked' | 'complete'
  readonly activation?: 'armed' | 'disarmed'
}

export interface CertifierOptions {
  readonly judge: JudgeFn
  readonly complete: (agent: Agent, ref: GoalRef) => unknown
  readonly getGoal: (agent: Agent) => GoalView | undefined
  readonly timeoutMs: number
  readonly failClosed: boolean
}

export interface ConsiderInput {
  readonly agent: Agent
  readonly ref: GoalRef
  readonly reply: string
  readonly proof?: string
}

export interface ConsiderResult {
  readonly completed: boolean
  readonly verdict: Verdict
  readonly fence: IdentityFence
}

interface InFlight {
  readonly controller: AbortController
  readonly fence: IdentityFence
}

export const CANCEL_OPERATIONS = new Set(['pause', 'clear', 'edit', 'block', 'complete'])

export class CompletionCertifier {
  private readonly inflight = new Map<string, InFlight>()

  constructor(private readonly options: CertifierOptions) {}

  cancel(agentId: string, reason = 'cancelled'): void {
    const job = this.inflight.get(agentId)
    if (job === undefined) return
    job.controller.abort(reason)
    this.inflight.delete(agentId)
  }

  isJudging(agentId: string): boolean {
    return this.inflight.has(agentId)
  }

  onGoalChanged(agent: Agent, operation: string): void {
    if (CANCEL_OPERATIONS.has(operation)) this.cancel(agent.id, operation)
  }

  /**
   * Judge a worker complete without calling `ctx.goals.complete`.
   * `completed: true` means APPROVED and the identity fence still holds.
   * The `update_goal` wrap uses this, then the original execute commits.
   */
  async certify(input: ConsiderInput): Promise<ConsiderResult> {
    const goal = this.options.getGoal(input.agent)
    const fence = identityFence(input.ref.id, input.ref.revision, input.reply)
    if (goal === undefined || goal.phase !== 'active') {
      return {
        completed: false,
        verdict: { decision: 'UNVERIFIABLE', reason: 'no active goal' },
        fence,
      }
    }
    if (goal.id !== input.ref.id || goal.revision !== input.ref.revision) {
      return {
        completed: false,
        verdict: { decision: 'UNVERIFIABLE', reason: 'stale goal ref' },
        fence,
      }
    }

    this.cancel(input.agent.id, 'superseded')
    const controller = new AbortController()
    this.inflight.set(input.agent.id, { controller, fence })

    const verdict = await this.judge(goal, input, controller)
    const job = this.inflight.get(input.agent.id)
    if (job !== undefined && sameFence(job.fence, fence)) this.inflight.delete(input.agent.id)

    if (controller.signal.aborted) {
      return {
        completed: false,
        verdict: { decision: 'UNVERIFIABLE', reason: abortReason(controller.signal) },
        fence,
      }
    }

    const latest = this.options.getGoal(input.agent)
    if (
      latest === undefined
      || latest.phase !== 'active'
      || latest.id !== fence.goalId
      || latest.revision !== fence.revision
    ) {
      return { completed: false, verdict, fence }
    }

    if (this.options.failClosed && verdict.decision !== 'APPROVED') {
      return { completed: false, verdict, fence }
    }
    if (verdict.decision !== 'APPROVED') {
      return { completed: false, verdict, fence }
    }

    return { completed: true, verdict, fence }
  }

  /**
   * ACP / marker path: certify, then commit through the injected complete verb.
   * The tool wrap must not use this — original `update_goal` execute owns complete.
   */
  async considerWorkerComplete(input: ConsiderInput): Promise<ConsiderResult> {
    const result = await this.certify(input)
    if (!result.completed) return result
    const latest = this.options.getGoal(input.agent)
    if (
      latest === undefined
      || latest.phase !== 'active'
      || latest.id !== result.fence.goalId
      || latest.revision !== result.fence.revision
    ) {
      return { completed: false, verdict: result.verdict, fence: result.fence }
    }
    this.options.complete(input.agent, { id: latest.id, revision: latest.revision })
    return result
  }

  private async judge(goal: GoalView, input: ConsiderInput, controller: AbortController): Promise<Verdict> {
    const timeout = setTimeout(() => {
      controller.abort('timeout')
    }, this.options.timeoutMs)
    try {
      return await this.options.judge({
        goalId: goal.id,
        revision: goal.revision,
        objective: goal.objective,
        reply: input.reply,
        parent: input.agent,
        ...input.proof === undefined ? {} : { proof: input.proof },
      }, controller.signal)
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        return { decision: 'UNVERIFIABLE', reason: abortReason(controller.signal) }
      }
      const message = error instanceof Error ? error.message : String(error)
      return { decision: 'UNVERIFIABLE', reason: message || 'the isolated judge did not finish' }
    } finally {
      clearTimeout(timeout)
    }
  }
}

function abortReason(signal: AbortSignal): string {
  const reason = signal.reason
  if (reason === 'timeout') return 'judge timed out'
  if (typeof reason === 'string' && reason) return reason
  return 'verification was cancelled'
}

export function createCertifier(options: CertifierOptions): CompletionCertifier {
  return new CompletionCertifier(options)
}
