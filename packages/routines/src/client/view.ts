import type { Routine, RoutineRule } from '../types.ts'

export type CadenceKind = RoutineRule['kind']

export interface RoutineRowView {
  readonly id: string
  readonly title: string
  readonly cadence: string
  readonly enabled: boolean
  readonly status: 'on' | 'paused'
  readonly nextRunAt?: number
  readonly lastError?: string
}

export interface CreateDraft {
  readonly title: string
  readonly prompt: string
  readonly kind: CadenceKind
  readonly at: string
  readonly seconds: string
  readonly cron: string
}

export function emptyDraft(): CreateDraft {
  return { title: '', prompt: '', kind: 'manual', at: '', seconds: '300', cron: '0 * * * *' }
}

export function cadenceSummary(rule: RoutineRule): string {
  if (rule.kind === 'manual') return 'manual'
  if (rule.kind === 'once') {
    const when = Number.isFinite(rule.at) ? new Date(rule.at).toISOString() : 'unset'
    return `once at ${when}`
  }
  if (rule.kind === 'interval') {
    const seconds = rule.seconds
    if (seconds % 3600 === 0 && seconds >= 3600) {
      const hours = seconds / 3600
      return hours === 1 ? 'every 1 hour' : `every ${hours} hours`
    }
    if (seconds % 60 === 0 && seconds >= 60) {
      const minutes = seconds / 60
      return minutes === 1 ? 'every 1 minute' : `every ${minutes} minutes`
    }
    return seconds === 1 ? 'every 1 second' : `every ${seconds} seconds`
  }
  return `cron ${rule.cron}`
}

export function lastError(routine: Pick<Routine, 'deliveryFailures' | 'runs'>): string | undefined {
  if (routine.deliveryFailures <= 0) return undefined
  const note = routine.runs.at(-1)?.note?.trim()
  return note || 'delivery failed'
}

export function rowView(routine: Routine): RoutineRowView {
  return {
    id: routine.id,
    title: routine.title,
    cadence: cadenceSummary(routine.rule),
    enabled: routine.enabled,
    status: routine.enabled ? 'on' : 'paused',
    ...routine.nextRunAt !== undefined ? { nextRunAt: routine.nextRunAt } : {},
    ...(() => {
      const error = lastError(routine)
      return error === undefined ? {} : { lastError: error }
    })(),
  }
}

export function formatNextRun(at: number): string {
  const date = new Date(at)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toISOString()
}

export function draftRule(draft: CreateDraft): RoutineRule | undefined {
  if (draft.kind === 'manual') return { kind: 'manual' }
  if (draft.kind === 'interval') {
    const seconds = Number(draft.seconds)
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined
    return { kind: 'interval', seconds: Math.floor(seconds) }
  }
  if (draft.kind === 'cron') {
    const cron = draft.cron.trim()
    if (cron.split(/\s+/).length !== 5) return undefined
    return { kind: 'cron', cron }
  }
  const at = Date.parse(draft.at)
  if (!Number.isFinite(at)) return undefined
  return { kind: 'once', at }
}

export function draftReady(draft: CreateDraft): boolean {
  return draft.title.trim().length > 0
    && draft.prompt.trim().length > 0
    && draftRule(draft) !== undefined
}
