import { useState, type ReactNode } from 'react'
import css from './header.module.css'

export const SKILL_ACTIONS = [
  { line: 'review', label: 'review', aria: 'reviewAria' },
  { line: 'wayfinder', label: 'wayfinder', aria: 'wayfinderAria' },
  { line: 'pr-warden', label: 'warden', aria: 'wardenAria' },
  { line: 'second-opinion', label: 'secondOpinion', aria: 'secondOpinionAria' },
] as const

export type SkillActionLine = typeof SKILL_ACTIONS[number]['line']

interface Rpc {
  call(route: string, endpoint: string, payload: { args: Record<string, unknown> }, signal?: AbortSignal): Promise<unknown>
}

interface SkillActionsProps {
  readonly sessionId?: string
  readonly rpc?: Rpc
  readonly t?: (key: string) => string
}

function unwrapExecute(result: unknown): unknown {
  if (result !== null && typeof result === 'object' && 'ok' in result) {
    const envelope = result as { ok: boolean; value?: unknown; error?: { message?: unknown } }
    if (!envelope.ok) {
      throw new Error(typeof envelope.error?.message === 'string' ? envelope.error.message : 'command rpc failed')
    }
    result = envelope.value
  }
  if (result === undefined || result === null) throw new Error('command did not run')
  if (typeof result === 'object' && 'result' in result) {
    const inner = (result as { result?: { kind?: unknown; text?: unknown } }).result
    if (inner?.kind === 'error') {
      throw new Error(typeof inner.text === 'string' ? inner.text : 'command failed')
    }
  }
  return result
}

export function commandExecuteLine(line: SkillActionLine): string {
  return line.startsWith('/') ? line : `/${line}`
}

export function executeSkillAction(rpc: Rpc, sessionId: string, line: SkillActionLine): Promise<unknown> {
  return rpc.call('/api', 'commands/execute', {
    args: { agentId: sessionId, line: commandExecuteLine(line), images: [] },
  }).then(unwrapExecute)
}

export function SkillActions({ sessionId, rpc, t = key => key }: SkillActionsProps): ReactNode {
  const available = Boolean(sessionId && rpc)
  const [feedback, setFeedback] = useState<{
    line: SkillActionLine
    status: 'running' | 'done' | 'error'
  } | null>(null)

  const run = async (line: SkillActionLine): Promise<void> => {
    if (!sessionId || !rpc) return
    setFeedback({ line, status: 'running' })
    try {
      await executeSkillAction(rpc, sessionId, line)
      setFeedback({ line, status: 'done' })
    } catch {
      setFeedback({ line, status: 'error' })
    }
  }

  return (
    <div className={css.actions} role="group" aria-label={t('actions')}>
      {SKILL_ACTIONS.map(action => {
        const status = feedback?.line === action.line ? feedback.status : undefined
        const statusLabel = status === 'running'
          ? t('actionRunning')
          : status === 'done'
            ? t('actionDone')
            : status === 'error'
              ? t('actionFailed')
              : undefined
        return (
          <button
            key={action.line}
            type="button"
            className={css.action}
            aria-label={statusLabel ? `${t(action.aria)} — ${statusLabel}` : t(action.aria)}
            aria-pressed={false}
            aria-busy={status === 'running'}
            data-status={status}
            disabled={!available || feedback?.status === 'running'}
            onClick={() => { void run(action.line) }}
          >
            {t(action.label)}
          </button>
        )
      })}
    </div>
  )
}
