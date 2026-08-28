/**
 * Wrap seam for native DSH sessions: intercept `update_goal` action
 * `complete` *before* `dsh-tool-goal` calls `ctx.goals.complete`.
 *
 * The supported seam is the `tools/execute` around-hook. Certify first.
 * REJECTED / UNVERIFIABLE throws and never calls `next()`. APPROVED calls
 * `next()` once — the original `update_goal` execute owns `ctx.goals.complete`,
 * wrapup, and the `{ goal, activation }` output schema.
 *
 * Sitting on `goal/changed` is too late — the complete mutation is already
 * committed. Wrapping `ctx.goals.complete` would also catch human `/goal`
 * and RPC `goal.complete`, which stay operator-authoritative.
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CompletionCertifier, GoalRef } from './certifier.ts'
import { lastAssistantReply } from './session.ts'

export const GOAL_COMPLETION_REJECTED = 'GOAL_COMPLETION_REJECTED'

export interface ToolExecuteView {
  readonly name?: string
  readonly arguments?: Record<string, unknown>
  readonly agent?: Agent
}

function goalRefOf(args: Record<string, unknown> | undefined): GoalRef | undefined {
  if (!args) return undefined
  const id = typeof args.goal_id === 'string' ? args.goal_id : typeof args.goalId === 'string' ? args.goalId : undefined
  const revision = typeof args.revision === 'number' ? args.revision : undefined
  if (!id || revision === undefined) return undefined
  return { id, revision }
}

export function refuseCompletion(verdict: { decision: string; reason: string }): Error {
  const error = new Error(`Goal completion was not certified: ${verdict.decision} - ${verdict.reason}`)
  ;(error as Error & { code?: string }).code = GOAL_COMPLETION_REJECTED
  return error
}

/**
 * Certify an `update_goal` complete, then delegate to the original body.
 * Does not call `ctx.goals.complete` itself.
 */
export async function aroundUpdateGoalExecute(
  exec: ToolExecuteView,
  next: () => Promise<unknown> | unknown,
  certifier: CompletionCertifier,
): Promise<unknown> {
  if (exec.name !== 'update_goal') return next()
  const args = exec.arguments ?? {}
  if (args.action !== 'complete') return next()

  const agent = exec.agent
  const ref = goalRefOf(args)
  if (!agent || !ref) {
    throw refuseCompletion({ decision: 'UNVERIFIABLE', reason: 'missing agent or goal ref' })
  }

  const reply = lastAssistantReply(agent.session.events)
    ?? `update_goal complete claimed for ${ref.id}@${ref.revision}`
  const result = await certifier.certify({ agent, ref, reply })
  if (!result.completed) throw refuseCompletion(result.verdict)
  return next()
}

/** Direct execute wrap for isolated tests. Production uses `tools/execute`. */
export function wrapUpdateGoalTool(
  tool: { name?: string; execute?: (args: Record<string, unknown>, exec: { agent?: Agent }) => unknown },
  certifier: CompletionCertifier,
): typeof tool {
  if (tool.name !== 'update_goal' || typeof tool.execute !== 'function') return tool
  const original = tool.execute.bind(tool)
  return {
    ...tool,
    execute(args: Record<string, unknown>, exec: { agent?: Agent }) {
      return aroundUpdateGoalExecute(
        { name: 'update_goal', arguments: args, agent: exec?.agent },
        () => original(args, exec),
        certifier,
      )
    },
  }
}

export function installToolsExecuteWrap(
  ctx: { on(event: string, listener: (...args: unknown[]) => unknown): unknown },
  certifier: CompletionCertifier,
): void {
  ctx.on('tools/execute', (exec: unknown, next: unknown) => {
    const proceed = typeof next === 'function' ? (next as () => Promise<unknown> | unknown) : async () => undefined
    return aroundUpdateGoalExecute(exec as ToolExecuteView, proceed, certifier)
  })
}
