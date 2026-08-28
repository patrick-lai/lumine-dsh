import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PermissionMode } from './config.ts'

export interface AcpPermissionOption {
  optionId: string
  kind?: string
  name?: string
}

export interface AcpPermissionParams {
  sessionId?: string
  options?: AcpPermissionOption[]
  toolCall?: { toolCallId?: string; title?: string; kind?: string }
}

export interface PermissionDecision {
  outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' }
}

function pick(options: AcpPermissionOption[], kinds: string[]): AcpPermissionOption | undefined {
  return options.find(option => kinds.includes(option.kind ?? ''))
}

/**
 * Answer `session/request_permission`.
 *
 * yolo: prefer allow_always, then allow_once.
 * ask: use dsh-user-approval when present. Missing/unavailable answerers
 * still allow — we do not silently auto-reject like dsh-subagent-acp.
 */
export async function decidePermission(
  params: AcpPermissionParams,
  options: {
    mode: PermissionMode
    agent: Agent
    signal?: AbortSignal
    approval?: { request(req: {
      agent: Agent
      toolName: string
      callId?: string
      reason?: string
      signal?: AbortSignal
    }): Promise<string> }
  },
): Promise<PermissionDecision> {
  const offered = params.options ?? []
  const allowAlways = pick(offered, ['allow_always', 'allow-always'])
  const allowOnce = pick(offered, ['allow_once', 'allow-once', 'allow_always', 'allow-always'])
  const rejectOnce = pick(offered, ['reject_once', 'reject-once', 'reject_always', 'reject-always'])

  const allow = (): PermissionDecision => {
    const option = allowAlways ?? allowOnce
    if (option === undefined) return { outcome: { outcome: 'cancelled' } }
    return { outcome: { outcome: 'selected', optionId: option.optionId } }
  }

  if (options.mode === 'yolo') return allow()

  const toolName = params.toolCall?.title ?? params.toolCall?.kind ?? 'tool'
  if (options.approval === undefined) return allow()

  try {
    const outcome = await options.approval.request({
      agent: options.agent,
      toolName,
      ...params.toolCall?.toolCallId === undefined ? {} : { callId: params.toolCall.toolCallId },
      reason: `${toolName} requested by the official product CLI`,
      signal: options.signal,
    })
    if (outcome === 'allowed-once') {
      const option = allowOnce ?? allowAlways
      if (option) return { outcome: { outcome: 'selected', optionId: option.optionId } }
    }
    if (outcome === 'rejected' && rejectOnce) {
      return { outcome: { outcome: 'selected', optionId: rejectOnce.optionId } }
    }
    if (outcome === 'unavailable') return allow()
    return { outcome: { outcome: 'cancelled' } }
  } catch {
    return allow()
  }
}
