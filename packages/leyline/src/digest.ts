/**
 * Bounded session digest + tail. One settlement event per session — not a
 * second session log and not a full transcript.
 */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { MAX_SCROLLBACK_CHARS, type ReceiptResult, type SessionReceipt, type ToolOutcome } from './payloads.ts'
import { nonEmpty, oneLine, scrubSecrets, suffix } from './scrub.ts'

export interface SessionDigest {
  goal?: string
  summary?: string
  result: ReceiptResult
  label: string
  digest: string
  tail: string
  toolOutcomes: ToolOutcome[]
  durationSeconds?: number
  agent?: string
  startedAt?: string
  settledAt: string
  receipt: SessionReceipt
}

function eventText(data: unknown, keys: string[]): string {
  if (!data || typeof data !== 'object') return ''
  const record = data as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
    if (value && typeof value === 'object') {
      const nested = value as { text?: unknown; content?: unknown }
      if (typeof nested.text === 'string') return nested.text
    }
  }
  const message = record.message as { content?: Array<{ type?: string; text?: string }> } | undefined
  if (Array.isArray(message?.content)) {
    return message.content
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string)
      .join('\n')
  }
  return ''
}

function isoFromMs(ms: number | undefined): string | undefined {
  if (!Number.isFinite(ms)) return undefined
  return new Date(ms as number).toISOString()
}

function turnReason(event: SessionEvent | undefined): { result: ReceiptResult; label: string } {
  const data = event?.data as { reason?: { kind?: string; error?: { message?: string } } } | undefined
  const kind = data?.reason?.kind
  if (kind === 'completed') return { result: 'success', label: 'success' }
  if (kind === 'error') {
    const detail = data?.reason?.error?.message
    return { result: 'failed', label: detail ? `failed · ${oneLine(detail)}` : 'failed' }
  }
  if (kind === 'aborted' || kind === 'interrupted') return { result: 'failed', label: `failed · ${kind}` }
  if (kind === 'blocked' || kind === 'max-tokens') return { result: 'failed', label: `failed · ${kind}` }
  return { result: 'failed', label: 'failed' }
}

export function digestSession(session: Session, recallIds: string[] = []): SessionDigest {
  const events = session.events
  const users = events.filter(event => event.type === 'user/message')
  const assistants = events.filter(event => event.type === 'assistant/message')
  const turns = events.filter(event => event.type === 'turn/end')
  const tools = events.filter(event => event.type === 'tool/call' || event.type === 'tool/result')
  const goal = nonEmpty(eventText(users[0]?.data, ['text']))
  const summary = nonEmpty(eventText(assistants.at(-1)?.data, ['text']))
  const { result, label } = turnReason(turns.at(-1))
  const started = isoFromMs(session.header.createdAt)
  const settled = isoFromMs(events.at(-1)?.time) ?? new Date().toISOString()
  const durationSeconds = started
    ? Math.max(0, Math.round((Date.parse(settled) - Date.parse(started)) / 1000))
    : undefined
  const agent = session.header.agentPreset

  const toolOutcomes: ToolOutcome[] = []
  const pending = new Map<string, ToolOutcome>()
  for (const event of tools) {
    const data = event.data as {
      name?: string
      arguments?: string
      callId?: string
      id?: string
      isError?: boolean
      content?: unknown
    } | undefined
    if (event.type === 'tool/call') {
      const id = data?.callId ?? data?.id ?? String(event.seq)
      pending.set(id, {
        toolName: data?.name ?? 'tool',
        succeeded: true,
        argPreview: typeof data?.arguments === 'string' ? data.arguments : '',
      })
    } else {
      const id = data?.callId ?? data?.id ?? String(event.seq)
      const prior = pending.get(id) ?? { toolName: 'tool', succeeded: true }
      const preview = typeof data?.content === 'string' ? data.content : JSON.stringify(data?.content ?? '')
      toolOutcomes.push({
        ...prior,
        succeeded: data?.isError !== true,
        resultPreview: preview,
      })
      pending.delete(id)
    }
  }
  for (const leftover of pending.values()) toolOutcomes.push(leftover)

  const lines = [
    'Outcome captured at session settlement by lumine-dsh (ground-truth result recorded after the agent session ended).',
  ]
  if (goal) lines.push(`GOAL: ${oneLine(scrubSecrets(goal))}`)
  lines.push(`RESULT: ${label}`)
  if (summary) lines.push(`SUMMARY: ${scrubSecrets(summary)}`)
  if (agent) lines.push(`AGENT: ${oneLine(agent)}`)
  if (recallIds.length > 0) {
    lines.push(`RECALLS: ${recallIds.join(', ')} (memories surfaced this session; provenance for later reinforcement)`)
  }

  const tailParts: string[] = []
  for (const event of events) {
    if (event.type !== 'user/message' && event.type !== 'assistant/message' && event.type !== 'assistant/chunk') continue
    const text = eventText(event.data, ['text', 'chunk'])
    if (!text) continue
    tailParts.push(`${event.type}: ${oneLine(text)}`)
  }

  return {
    goal,
    summary,
    result,
    label,
    digest: lines.join('\n'),
    tail: suffix(tailParts.join('\n'), MAX_SCROLLBACK_CHARS),
    toolOutcomes,
    durationSeconds,
    agent,
    startedAt: started,
    settledAt: settled,
    receipt: {
      result,
      label,
      recall_ids: recallIds,
    },
  }
}
