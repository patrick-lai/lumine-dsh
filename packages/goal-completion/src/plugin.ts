/**
 * Fail-closed goal completion policy for DeepSeek Harness.
 *
 * Intercepts worker `update_goal` complete via the `tools/execute`
 * around-hook (never human `/goal` or RPC `goal.complete`). On lumine ACP
 * sessions only, harvests line-start `GOAL REACHED` / `BLOCKED:` markers
 * after a settled turn — mounted instead of `goal-round-driver`.
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
import { agentScopedRoundDriverEnabled, isLumineAcpSession, turnEndKind } from './session.ts'
import { installToolsExecuteWrap } from './tools-wrap.ts'

export const name = 'lumine-goal-completion'
/**
 * Caller-fiber services `start()` reads as hard `ctx.*` properties.
 * Official `@deepseek-ai/dsh-tool-subagent` inject is
 * `['tools', 'subagents', 'systemPrompt']`. Published
 * `applyChildComposition` does `childCtx.systemPrompt.context()` /
 * `section()` on the caller fiber (r6: `cannot get property "systemPrompt"
 * without inject`). `agentPresets` / `sandboxPolicy` / `approval` are
 * `ctx.get(...)` only — those do not throw. `parent.ctx.agents.create`
 * already ran in r6 before the systemPrompt throw, so `agents` is not a
 * missing caller-fiber inject. Keep `goals` for harvest complete.
 */
export const inject = ['goals', 'subagents', 'tools', 'systemPrompt']

export type { Config } from './config.ts'
export { resolveConfig, DEFAULT_START_TIMEOUT_MS } from './config.ts'
export { createCertifier, CANCEL_OPERATIONS } from './certifier.ts'
export { scanMarkers, parseJudgeOutput, REACHED_MARKER, BLOCKED_MARKER, VERDICT_MARKER } from './markers.ts'
export { identityFence, replyFingerprint } from './fingerprint.ts'
export { fakeJudge, judgePrompt, foldJudgeText, createRuntimeJudge, raceStart, START_DID_NOT_SETTLE } from './judge.ts'
export { pinDirective, continueNudge, PLUGIN_SOURCE, verdictLine, recordVerdictNotice } from './pin.ts'
export {
  canMountAcpFallback,
  collectPluginIds,
  hasRoundDriver,
  agentScopedRoundDriverEnabled,
  isLumineAcpSession,
  lastAssistantReply,
  lastBoundAcpSession,
  LUMINE_ACP_PRESETS,
} from './session.ts'
export { createAcpFallback } from './acp-fallback.ts'
export {
  wrapUpdateGoalTool,
  installToolsExecuteWrap,
  aroundUpdateGoalExecute,
} from './tools-wrap.ts'
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
    installToolsExecuteWrap(toolsCtx, certifier)
  })

  ctx.inject(['agents'], (live) => {
    const fallbacks = new WeakMap<Agent, ReturnType<typeof createAcpFallback>>()

    const fallbackFor = (agent: Agent) => {
      const existing = fallbacks.get(agent)
      if (existing) return existing
      // Per-session, not a host-global veto. Stock DSH always loads the
      // host-plane driver; that must not kill ACP harvest forever.
      const created = createAcpFallback({
        certifier,
        goals,
        sessionIsLumineAcp: isLumineAcpSession(agent.session),
        roundDriverPresent: agentScopedRoundDriverEnabled(agent.ctx),
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
        if (goal?.phase === 'active') {
          const fallback = fallbackFor(agent)
          fallback.onCreate(agent, goal.objective)
          // Host-plane goal-round-driver drives any armed agent. Disarm so
          // it no-ops on this ACP session; harvest owns continue instead.
          if (fallback.mounted && typeof goals.disarm === 'function' && goal.activation === 'armed') {
            try {
              goals.disarm(agent)
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error)
              live.logger.warn(`lumine-goal-completion: could not disarm ACP goal: ${message}`)
            }
          }
        }
      }
    })

    live.on('session/event', (subject: unknown, event: unknown) => {
      const session = subject as Agent['session']
      const row = event as { type?: string; data?: unknown }
      // ACP `TurnProjector.finish` writes assistant/message then turn/end.
      // Settle on either so a missed turn/end still starts the judge.
      if (row?.type !== 'turn/end' && row?.type !== 'assistant/message') return
      const agent = live.agents.get(session.id)
      if (agent === undefined) return
      // Published Session.append dispatches session/event while `appending`
      // is true and does not await the listener. Defer one tick so start()
      // / verdict append cannot reenter the open publication.
      return Promise.resolve().then(() =>
        fallbackFor(agent).onSettledTurn({
          agent,
          session: agent.session ?? session,
          endKind: row.type === 'turn/end' ? turnEndKind(row.data) : undefined,
        }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          live.logger.warn(`lumine-goal-completion: ACP settle failed: ${message}`)
        }),
      )
    })
  })
}

export default {
  name,
  inject,
  apply,
}
