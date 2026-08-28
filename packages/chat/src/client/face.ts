/** Collapsed activity-strip copy. Verbs match Lumine inbuilt chat, not DSH's "Tool call · name". */

import {
  argsRawOf,
  callName,
  isSettledTool,
  type ToolCallBlockLike,
  type ToolMember,
} from './group.ts'

export { callName }

export type ToolKind = 'read' | 'search' | 'fetch' | 'edit' | 'write' | 'shell' | 'other'
export type RunOutcome = 'working' | 'succeeded' | 'mixed' | 'failed'
export type MemberState = 'running' | 'completed' | 'failed'

export interface FaceSnapshot {
  readonly verb: string
  readonly target: string
  readonly count: number
  readonly working: boolean
  readonly outcome: RunOutcome
  readonly failed: number
  readonly recovered: number
  readonly summary: string
}

const KIND_VERB: Record<ToolKind, string> = {
  read: 'Read',
  search: 'Search',
  fetch: 'Fetch',
  edit: 'Edit',
  write: 'Write',
  shell: 'Run',
  other: 'Tool',
}

export function toolKind(name: string): ToolKind {
  const folded = name.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (
    folded === 'read' || folded === 'readfile' || folded === 'openfile'
    || folded.endsWith('readfile') || folded.startsWith('read')
  ) return 'read'
  if (
    folded === 'grep' || folded === 'glob' || folded === 'search'
    || folded === 'searchtool' || folded.includes('grep') || folded.includes('glob')
    || folded.endsWith('search')
  ) return 'search'
  if (
    folded === 'webfetch' || folded === 'openpage' || folded === 'openpagewithfind'
    || folded.includes('fetch')
  ) return 'fetch'
  if (
    folded === 'searchreplace' || folded === 'edit' || folded === 'strreplace'
    || folded.includes('replace') || folded.endsWith('edit')
  ) return 'edit'
  if (folded === 'write' || folded === 'writefile' || folded.startsWith('write')) return 'write'
  if (
    folded === 'bash' || folded === 'shell' || folded === 'runterminalcommand'
    || folded.includes('terminal') || folded.includes('shell') || folded === 'run'
  ) return 'shell'
  return 'other'
}

export function verbFor(name: string): string {
  const kind = toolKind(name)
  if (kind !== 'other') return KIND_VERB[kind]
  const trimmed = name.trim()
  if (!trimmed) return 'Tool'
  if (trimmed.includes(' ')) return trimmed
  return trimmed.replace(/[_-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

export function memberState(block: ToolCallBlockLike): MemberState {
  if (!isSettledTool(block)) return 'running'
  return block.isError ? 'failed' : 'completed'
}

export function isWorkingMember(member: ToolMember): boolean {
  return memberState(member.block) === 'running'
}

function jsonObject(raw: string): Record<string, unknown> | undefined {
  const text = raw.trim()
  if (!text || (text[0] !== '{' && text[0] !== '[')) return undefined
  try {
    const value = JSON.parse(text) as unknown
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    return undefined
  }
  return undefined
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function targetFor(block: ToolCallBlockLike): string {
  const raw = argsRawOf(block)
  const record = jsonObject(raw)
  if (record) {
    const path = firstString(record, [
      'path', 'file_path', 'target_file', 'file', 'uri', 'url',
      'command', 'query', 'pattern', 'glob', 'q',
    ])
    if (path) return shorten(path)
  }
  const line = raw.replace(/\s+/g, ' ').trim()
  if (!line || line === '{}') return ''
  return shorten(line)
}

function shorten(value: string): string {
  if (value.length <= 64) return value
  return `…${value.slice(-63)}`
}

function failureTally(members: readonly ToolMember[]): { recovered: number; unrecovered: number } {
  const completedLater = new Set<string>()
  let recovered = 0
  let unrecovered = 0
  for (let index = members.length - 1; index >= 0; index -= 1) {
    const member = members[index]
    if (!member) continue
    const kind = toolKind(member.toolName)
    const state = memberState(member.block)
    if (state === 'completed') completedLater.add(kind)
    else if (state === 'failed') {
      if (completedLater.has(kind)) recovered += 1
      else unrecovered += 1
    }
  }
  return { recovered, unrecovered }
}

function endsOnFailure(members: readonly ToolMember[]): boolean {
  for (let index = members.length - 1; index >= 0; index -= 1) {
    const member = members[index]
    if (!member) continue
    return memberState(member.block) === 'failed'
  }
  return false
}

function completedCount(members: readonly ToolMember[]): number {
  return members.reduce((count, member) => (
    memberState(member.block) === 'completed' ? count + 1 : count
  ), 0)
}

export function runOutcome(members: readonly ToolMember[]): RunOutcome {
  if (members.some(isWorkingMember)) return 'working'
  const tally = failureTally(members)
  if (tally.unrecovered <= 0) return 'succeeded'
  return endsOnFailure(members) || tally.unrecovered > completedCount(members) ? 'failed' : 'mixed'
}

export function runSummary(members: readonly ToolMember[]): string {
  const counts: Partial<Record<ToolKind, number>> = {}
  for (const member of members) {
    const kind = toolKind(member.toolName)
    counts[kind] = (counts[kind] ?? 0) + 1
  }
  const parts: string[] = []
  const reads = counts.read ?? 0
  const searches = counts.search ?? 0
  const fetches = counts.fetch ?? 0
  if (reads) parts.push(reads === 1 ? '1 file read' : `${reads} files read`)
  if (searches) parts.push(searches === 1 ? '1 search' : `${searches} searches`)
  if (fetches) parts.push(fetches === 1 ? '1 fetch' : `${fetches} fetches`)
  const described = reads + searches + fetches
  const remaining = members.length - described
  if (remaining > 0) parts.push(remaining === 1 ? '1 tool call' : `${remaining} tool calls`)
  return parts.join(' · ')
}

export function faceSnapshot(members: readonly ToolMember[]): FaceSnapshot {
  const working = members.some(isWorkingMember)
  const live = [...members].reverse().find(isWorkingMember) ?? members.at(-1)
  const name = live?.toolName ?? 'tool'
  const tally = failureTally(members)
  return {
    verb: verbFor(name),
    target: live ? targetFor(live.block) : '',
    count: members.length,
    working,
    outcome: runOutcome(members),
    failed: tally.unrecovered,
    recovered: tally.recovered,
    summary: runSummary(members),
  }
}

export function memberLine(member: ToolMember): { verb: string; target: string; state: MemberState } {
  return {
    verb: verbFor(member.toolName),
    target: targetFor(member.block),
    state: memberState(member.block),
  }
}

