/**
 * ACP host fallback. Mounted only on lumine ACP sessions and never beside
 * `dsh-goal-round-driver`. After a settled assistant turn: scan markers,
 * certify `GOAL REACHED`, block on `BLOCKED`, otherwise hidden-continue.
 *
 * A completion candidate always starts the judge. The verdict is written as a
 * host notice. Fail-closed outcomes halt auto-continue — they must not nudge
 * forever the way a missing `GOAL REACHED` does.
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CompletionCertifier, GoalView } from './certifier.ts'
import { scanMarkers } from './markers.ts'
import { continueNudge, pinDirective, pluginNotice, recordVerdictNotice } from './pin.ts'
import {
  canMountAcpFallback,
  isLumineAcpSession,
  isPluginNoticeSource,
  lastAssistantReply,
  type SessionLike,
} from './session.ts'

export interface FallbackGoals {
  get(agent: Agent): GoalView | undefined
  complete(agent: Agent, ref: { id: string; revision: number }): unknown
  block(agent: Agent, ref: { id: string; revision: number }, reason: { code: string; message: string }): unknown
}

export interface FallbackState {
  rounds: number
  lastNudge?: string
  pinned?: boolean
  judging?: boolean
  halted?: boolean
  lastVerdict?: string
}

export interface AcpFallbackOptions {
  readonly certifier: CompletionCertifier
  readonly goals: FallbackGoals
  readonly sessionIsLumineAcp: boolean
  readonly roundDriverPresent: boolean
}

export interface SettledTurnInput {
  readonly agent: Agent
  readonly session: SessionLike
  readonly endKind?: string
}

export type HarvestAction = 'complete' | 'block' | 'nudge' | 'ignore' | 'halt'

export class AcpFallback {
  readonly mounted: boolean
  private readonly states = new WeakMap<Agent, FallbackState>()

  constructor(private readonly options: AcpFallbackOptions) {
    this.mounted = canMountAcpFallback({
      sessionIsLumineAcp: options.sessionIsLumineAcp,
      roundDriverPresent: options.roundDriverPresent,
    })
  }

  state(agent: Agent): FallbackState {
    const existing = this.states.get(agent)
    if (existing) return existing
    const created: FallbackState = { rounds: 0 }
    this.states.set(agent, created)
    return created
  }

  onCreate(agent: Agent, objective: string): void {
    if (!this.mounted) return
    const goal = this.options.goals.get(agent)
    if (goal === undefined || goal.phase !== 'active') return
    const notice = pluginNotice(pinDirective(objective), `pin: ${objective}`)
    if (typeof agent.inject === 'function') agent.inject(notice as never)
    else agent.followup(notice as never)
    this.state(agent).pinned = true
  }

  async onSettledTurn(input: SettledTurnInput): Promise<{
    action: HarvestAction
    nudge?: string
    verdict?: string
  }> {
    if (!this.mounted) return { action: 'ignore' }
    if (!isLumineAcpSession(input.session)) return { action: 'ignore' }
    if (input.endKind && input.endKind !== 'completed') return { action: 'ignore' }

    const goal = this.options.goals.get(input.agent)
    if (goal === undefined || goal.phase !== 'active') return { action: 'ignore' }

    const state = this.state(input.agent)
    if (state.judging || this.options.certifier.isJudging(input.agent.id)) {
      return { action: 'ignore' }
    }

    const lastUser = lastUserSource(input.session.events)
    const operatorTurn = !isPluginNoticeSource(lastUser)
    if (state.halted && !operatorTurn) return { action: 'ignore' }
    if (operatorTurn) state.halted = false

    const reply = lastAssistantReply(input.session) ?? ''
    const marker = scanMarkers(reply)
    if (marker.kind === 'blocked') {
      this.options.goals.block(input.agent, { id: goal.id, revision: goal.revision }, {
        code: 'model-reported',
        message: marker.reason ?? 'blocked',
      })
      return { action: 'block' }
    }
    if (marker.kind === 'completionCandidate') {
      return this.judgeCandidate(input, goal, reply, marker.proof)
    }

    const text = this.nudge(input.agent, goal, { increment: !operatorTurn })
    return { action: 'nudge', nudge: text }
  }

  private async judgeCandidate(
    input: SettledTurnInput,
    goal: GoalView,
    reply: string,
    proof?: string,
  ): Promise<{ action: HarvestAction; verdict?: string }> {
    const state = this.state(input.agent)
    state.judging = true
    try {
      const result = await this.options.certifier.considerWorkerComplete({
        agent: input.agent,
        ref: { id: goal.id, revision: goal.revision },
        reply,
        ...proof === undefined ? {} : { proof },
      })
      const verdict = recordVerdictNotice(input.agent, result.verdict)
      state.lastVerdict = verdict
      state.halted = true
      if (result.completed) return { action: 'complete', verdict }
      return { action: 'halt', verdict }
    } catch (error: unknown) {
      const reason = error instanceof Error && error.message
        ? error.message
        : 'the isolated judge did not finish'
      const verdict = recordVerdictNotice(input.agent, { decision: 'UNVERIFIABLE', reason })
      state.lastVerdict = verdict
      state.halted = true
      return { action: 'halt', verdict }
    } finally {
      state.judging = false
    }
  }

  /**
   * Hidden continue. Operator turns must not increment the auto-continue
   * round counter (inventory contract). Auto-continue (plugin-notice) turns do.
   * Never used after a GOAL REACHED verdict — that path halts.
   */
  private nudge(agent: Agent, goal: GoalView, options: { increment: boolean }): string {
    const state = this.state(agent)
    if (options.increment) state.rounds += 1
    else if (state.rounds === 0) state.rounds = 1
    const text = continueNudge(goal.objective, state.rounds)
    state.lastNudge = text
    agent.followup(pluginNotice(text, `PINNED GOAL — not yet reached (auto-continue round ${state.rounds})`) as never)
    return text
  }
}

function lastUserSource(events: ReadonlyArray<{ type: string; data?: unknown }> | undefined): unknown {
  if (!events) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message') continue
    const data = event.data as { source?: unknown; message?: { source?: unknown } } | undefined
    return data?.source ?? data?.message?.source
  }
  return undefined
}

export function createAcpFallback(options: AcpFallbackOptions): AcpFallback {
  return new AcpFallback(options)
}
