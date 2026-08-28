/**
 * Wrap seam for native DSH sessions: intercept `update_goal` action
 * `complete` *before* `dsh-tool-goal` calls `ctx.goals.complete`.
 *
 * Sitting on `goal/changed` is too late — the complete mutation is already
 * committed. Wrapping `ctx.goals.complete` would also catch human `/goal`
 * and RPC `goal.complete`, which stay operator-authoritative.
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CompletionCertifier, GoalRef } from './certifier.ts'
import { lastAssistantReply } from './session.ts'

const WRAPPED = Symbol('lumine-goal-completion.wrapped')

interface ToolLike {
  name?: string
  execute?: (args: Record<string, unknown>, exec: { agent?: Agent }) => unknown
  [key: string]: unknown
}

interface ToolsLike {
  register(tool: ToolLike): unknown
  get?(name: string): ToolLike | undefined
  lookup?(name: string): ToolLike | undefined
}

function agentOf(exec: { agent?: Agent } | undefined, fallback?: Agent): Agent | undefined {
  return exec?.agent ?? fallback
}

function goalRefOf(args: Record<string, unknown>): GoalRef | undefined {
  const id = typeof args.goal_id === 'string' ? args.goal_id : typeof args.goalId === 'string' ? args.goalId : undefined
  const revision = typeof args.revision === 'number' ? args.revision : undefined
  if (!id || revision === undefined) return undefined
  return { id, revision }
}

export function wrapUpdateGoalTool(
  tool: ToolLike,
  certifier: CompletionCertifier,
  fallbackAgent?: Agent,
): ToolLike {
  if (tool.name !== 'update_goal' || typeof tool.execute !== 'function') return tool
  if ((tool as { [WRAPPED]?: boolean })[WRAPPED]) return tool
  const original = tool.execute.bind(tool)
  const wrapped: ToolLike = {
    ...tool,
    async execute(args: Record<string, unknown>, exec: { agent?: Agent }) {
      if (args?.action === 'complete') {
        const agent = agentOf(exec, fallbackAgent)
        const ref = goalRefOf(args)
        if (agent && ref) {
          const reply = lastAssistantReply(agent.session.events)
            ?? `update_goal complete claimed for ${ref.id}@${ref.revision}`
          const result = await certifier.considerWorkerComplete({ agent, ref, reply })
          if (!result.completed) {
            const error = new Error(
              `Goal completion was not certified: ${result.verdict.decision} - ${result.verdict.reason}`,
            )
            ;(error as Error & { code?: string }).code = 'GOAL_COMPLETION_REJECTED'
            throw error
          }
          // Certifier already called ctx.goals.complete. Do not run the
          // original execute — it would complete a second time and trip CAS.
          return { certified: true, verdict: result.verdict }
        }
      }
      return original(args, exec)
    },
  }
  Object.defineProperty(wrapped, WRAPPED, { value: true })
  return wrapped
}

export function installUpdateGoalWrap(
  tools: ToolsLike,
  certifier: CompletionCertifier,
  fallbackAgent?: Agent,
): void {
  const register = tools.register.bind(tools)
  tools.register = (tool: ToolLike) => register(wrapUpdateGoalTool(tool, certifier, fallbackAgent))
  for (const lookup of [tools.get?.bind(tools), tools.lookup?.bind(tools)]) {
    if (!lookup) continue
    const existing = lookup('update_goal')
    if (existing && typeof existing.execute === 'function') {
      const wrapped = wrapUpdateGoalTool(existing, certifier, fallbackAgent)
      if (wrapped !== existing) existing.execute = wrapped.execute
    }
  }
}
