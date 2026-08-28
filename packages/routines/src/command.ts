import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { parseClock, parseWeekday } from './calendar.ts'
import type { RoutineService } from './service.ts'
import type { CreateRoutineInput, Routine, RoutineRule } from './types.ts'
import { RoutineError } from './types.ts'

const USAGE = 'Usage: /routine [list|create <title> -- <prompt>|enable <id>|disable <id>|run <id>|delete <id>]'

type RoutineCommand =
  | { readonly kind: 'list' }
  | { readonly kind: 'create'; readonly title: string; readonly prompt: string; readonly extra: string }
  | { readonly kind: 'enable'; readonly id: string; readonly enabled: boolean }
  | { readonly kind: 'run'; readonly id: string }
  | { readonly kind: 'delete'; readonly id: string }
  | { readonly kind: 'help' }

export function parseRoutineCommand(rawInput: string): RoutineCommand {
  const input = rawInput.trim()
  if (input.length === 0 || input.toLowerCase() === 'list') return { kind: 'list' }
  if (input.toLowerCase() === 'help') return { kind: 'help' }
  const [verb, ...rest] = input.split(/\s+/)
  const lower = (verb ?? '').toLowerCase()
  if (lower === 'create') {
    const body = input.slice(verb?.length ?? 0).trim()
    const split = body.split(/\s+--\s+/)
    const title = (split[0] ?? '').trim()
    const prompt = (split[1] ?? '').trim()
    if (!title || !prompt) return { kind: 'help' }
    return { kind: 'create', title, prompt, extra: split.slice(2).join(' -- ') }
  }
  const id = rest.join(' ').trim()
  if (lower === 'enable' && id) return { kind: 'enable', id, enabled: true }
  if (lower === 'disable' && id) return { kind: 'enable', id, enabled: false }
  if ((lower === 'run' || lower === 'runnow') && id) return { kind: 'run', id }
  if (lower === 'delete' && id) return { kind: 'delete', id }
  return { kind: 'help' }
}

export function parseCreateFlags(extra: string, timezone: string): Pick<CreateRoutineInput, 'rule' | 'mode' | 'quietHours'> {
  const flags = extra.trim()
  let rule: RoutineRule = { kind: 'manual' }
  let mode: CreateRoutineInput['mode'] = 'cron'
  const cron = /(?:^|\s)--cron\s+(\S+(?:\s+\S+){4})/.exec(flags)
  const interval = /(?:^|\s)--every\s+(\d+)/.exec(flags)
  if (cron?.[1]) rule = { kind: 'cron', cron: cron[1] }
  else if (interval?.[1]) rule = { kind: 'interval', seconds: Number(interval[1]) }
  if (/(?:^|\s)--grind(?:\s|$)/.test(flags)) mode = 'grind'
  const quiet = /(?:^|\s)--quiet\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/.exec(flags)
  const start = quiet?.[1] ? parseClock(quiet[1]) : undefined
  const end = quiet?.[2] ? parseClock(quiet[2]) : undefined
  return {
    rule,
    mode,
    ...start !== undefined && end !== undefined
      ? { quietHours: { startMinute: start, endMinute: end, timeZoneIdentifier: timezone } }
      : {},
  }
}

function renderList(routines: Routine[]): string {
  if (routines.length === 0) {
    return `No routines.\n${USAGE}\n\nThis is host-owned and durable. It is not @deepseek-ai/dsh-schedule (session-local reminders).`
  }
  return [
    'Routines (host-owned; survives restart; not dsh-schedule):',
    ...routines.map(routine => {
      const next = routine.nextRunAt === undefined ? 'none' : new Date(routine.nextRunAt).toISOString()
      const busy = routine.activeRun ? ' [in-flight]' : ''
      return `- ${routine.id}  ${routine.enabled ? 'on' : 'off'}  ${routine.mode}  ${ruleLabel(routine)}  next=${next}${busy}  ${routine.title}`
    }),
    '',
    USAGE,
  ].join('\n')
}

function ruleLabel(routine: Routine): string {
  switch (routine.rule.kind) {
    case 'cron': return `cron ${routine.rule.cron}`
    case 'interval': return `every ${routine.rule.seconds}s`
    case 'once': return `once ${new Date(routine.rule.at).toISOString()}`
    case 'manual': return 'manual'
    default: return 'rule'
  }
}

export async function executeRoutineCommand(service: RoutineService, invocation: CommandInvocation): Promise<CommandResult> {
  const command = parseRoutineCommand(invocation.rawInput)
  try {
    switch (command.kind) {
      case 'help':
        return { kind: 'success', text: USAGE }
      case 'list':
        return { kind: 'success', text: renderList(await service.list()) }
      case 'create': {
        const created = await service.create({
          title: command.title,
          promptTemplate: command.prompt,
          ...parseCreateFlags(command.extra, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
        })
        return { kind: 'success', text: `Routine created ${created.id}\n${renderList([created])}` }
      }
      case 'enable': {
        const updated = await service.enable(command.id, command.enabled)
        return { kind: 'success', text: `Routine ${updated.id} ${updated.enabled ? 'enabled' : 'disabled'}.` }
      }
      case 'run': {
        const ran = await service.runNow(command.id)
        return { kind: 'success', text: `Routine ${ran.id} launched.` }
      }
      case 'delete': {
        const removed = await service.delete(command.id)
        return { kind: 'success', text: `Routine ${removed.id} deleted.` }
      }
      default:
        return { kind: 'success', text: USAGE }
    }
  } catch (error: unknown) {
    if (error instanceof RoutineError) {
      return { kind: 'error', text: error.message }
    }
    throw error
  }
}

export { parseWeekday }
