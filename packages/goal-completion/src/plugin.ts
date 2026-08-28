/**
 * Fail-closed goal completion policy for DeepSeek Harness.
 *
 * Wraps worker `update_goal` complete (never human `/goal` or RPC
 * `goal.complete`) and, on lumine ACP sessions only, harvests line-start
 * `GOAL REACHED` / `BLOCKED:` markers after a settled turn.
 *
 * Loaded via `src/index.ts` after DSH peers are linked.
 *
 * @module @lumine/dsh-goal-completion
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createAcpFallback } from './acp-fallback.ts'
import { createCertifier } from './certifier.ts'
import { resolveConfig, type Config } from './config.ts'
import { resolveJudge } from './judge.ts'
import { hasRoundDriver, isLumineAcpSession, turnEndKind } from './session.ts'
import { installUpdateGoalWrap } from './tools-wrap.ts'

export const name = 'lumine-goal-completion'
export const inject = ['goals']

export type { Config } from './config.ts'
export { resolveConfig } from './config.ts'
export { createCertifier, CANCEL_OPERATIONS } from './certifier.ts'
export { scanMarkers, parseJudgeOutput, REACHED_MARKER, BLOCKED_MARKER, VERDICT_MARKER } from './markers.ts'
export { identityFence, replyFingerprint } from './fingerprint.ts'
export { fakeJudge, judgePrompt, foldJudgeText, createRuntimeJudge } from './judge.ts'
export { pinDirective, continueNudge, PLUGIN_SOURCE } from './pin.ts'
export {
  canMountAcpFallback,
  collectPluginIds,
  hasRoundDriver,
  isLumineAcpSession,
  lastAssistantReply,
  lastBoundAcpSession,
  LUMINE_ACP_PRESETS,
} from './session.ts'
export { createAcpFallback } from './acp-fallback.ts'
export { wrapUpdateGoalTool, installUpdateGoalWrap } from './tools-wrap.ts'
export { ensureDshPeers, DSH_PEERS } from './peers.ts'

function changedAgent(payload: unknown): Agent | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as { agent?: Agent }
  return record.agent
}

function changedOperation(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as { change?: { operation?: string }; operation?: string }
  return record.change?.operation ?? record.operation
}

export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const goals = ctx.goals
  if (goals === undefined) {
    ctx.logger.warn('lumine-goal-completion: ctx.goals missing; plugin is idle')
    return
  }

  const certifier = createCertifier({
    judge: resolveJudge(ctx, resolved),
    complete: (agent, ref) => goals.complete(agent, ref),
    getGoal: agent => goals.get(agent),
    timeoutMs: resolved.timeoutMs,
    failClosed: resolved.failClosed,
  })

  ctx.inject(['tools'], (toolsCtx) => {
    if (toolsCtx.tools) installUpdateGoalWrap(toolsCtx.tools, certifier)
  })

  const roundDriverPresent = hasRoundDriver(ctx)

  ctx.inject(['agents'], (live) => {
    const fallbacks = new WeakMap<Agent, ReturnType<typeof createAcpFallback>>()

    const fallbackFor = (agent: Agent) => {
      const existing = fallbacks.get(agent)
      if (existing) return existing
      const created = createAcpFallback({
        certifier,
        goals,
        sessionIsLumineAcp: isLumineAcpSession(agent.session),
        roundDriverPresent,
      })
      fallbacks.set(agent, created)
      return created
    }

    live.on('goal/changed', (payload: unknown) => {
      const agent = changedAgent(payload)
      const operation = changedOperation(payload)
      if (agent && operation) certifier.onGoalChanged(agent, operation)
      if (agent && operation === 'create') {
        const goal = goals.get(agent)
        if (goal?.phase === 'active') fallbackFor(agent).onCreate(agent, goal.objective)
      }
    })

    live.on('session/event', (subject: unknown, event: unknown) => {
      const session = subject as Agent['session']
      const row = event as { type?: string; data?: unknown }
      if (row?.type !== 'turn/end') return
      const agent = live.agents.get(session.id)
      if (agent === undefined) return
      void fallbackFor(agent).onSettledTurn({
        agent,
        session,
        endKind: turnEndKind(row.data),
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        live.logger.warn(`lumine-goal-completion: ACP settle failed: ${message}`)
      })
    })
  })
}

export default {
  name,
  inject,
  apply,
}
