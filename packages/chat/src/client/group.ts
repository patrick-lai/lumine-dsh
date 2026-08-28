/** Fold consecutive tool-call chat nodes the way Lumine inbuilt chat does. */

export const MINIMUM_GROUP_SIZE = 2

export type RunRole = 'solo' | 'leader' | 'follower'

export interface ChatNodeLike {
  readonly key?: string
  readonly kind: string
  readonly data?: {
    readonly root?: ToolCallBlockLike
  }
}

export interface RunningToolCallLike {
  readonly callId: string
  readonly name: string
  readonly argsRaw: string
  readonly subCalls?: readonly ToolCallBlockLike[]
}

export interface ToolResultLike {
  readonly kind: 'tool-result'
  readonly callId: string
  readonly call: { readonly name: string; readonly argsRaw: string } | null
  readonly isError: boolean
  readonly content?: readonly unknown[]
  readonly error?: { readonly name?: string; readonly code?: string }
  readonly subCalls?: readonly ToolCallBlockLike[]
}

export type ToolCallBlockLike = RunningToolCallLike | ToolResultLike

export interface ToolMember {
  readonly key: string
  readonly callId: string
  readonly toolName: string
  readonly block: ToolCallBlockLike
}

export interface RunView {
  readonly role: RunRole
  readonly members: readonly ToolMember[]
}

export function isToolCallKind(kind: string | undefined): boolean {
  return kind === 'tool-call'
}

export function isSettledTool(block: ToolCallBlockLike): block is ToolResultLike {
  return 'kind' in block && block.kind === 'tool-result'
}

export function callName(block: ToolCallBlockLike): string {
  if (isSettledTool(block)) return block.call?.name ?? ''
  return block.name
}

export function callIdOf(block: ToolCallBlockLike): string {
  return block.callId
}

export function argsRawOf(block: ToolCallBlockLike): string {
  if (isSettledTool(block)) return block.call?.argsRaw ?? ''
  return block.argsRaw
}

export function subCallsOf(block: ToolCallBlockLike): readonly ToolCallBlockLike[] {
  return block.subCalls ?? []
}

export function walkToolTree(block: ToolCallBlockLike): ToolCallBlockLike[] {
  const out: ToolCallBlockLike[] = [block]
  for (const child of subCallsOf(block)) out.push(...walkToolTree(child))
  return out
}

function contentText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join('\n')
  if (typeof value === 'object' && 'text' in value && typeof (value as { text: unknown }).text === 'string') {
    return (value as { text: string }).text
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function resultText(block: ToolCallBlockLike): string {
  if (!isSettledTool(block)) return ''
  const body = contentText(block.content)
  if (body) return body
  if (block.isError) {
    const name = block.error?.name ?? 'failed'
    const code = block.error?.code
    return code ? `${name}: ${code}` : name
  }
  return ''
}

export function toolViewOwner(
  block: ToolCallBlockLike,
  options: {
    cwd?: string
    openFile?: (path: string) => void
    inspectCall?: (callId: string) => void
  },
): Record<string, unknown> {
  const callId = callIdOf(block)
  return {
    callId,
    toolName: callName(block) || 'tool',
    block,
    cwd: options.cwd,
    openFile: options.openFile,
    inspect: options.inspectCall ? () => { options.inspectCall?.(callId) } : undefined,
  }
}

export function memberFromNode(key: string, node: ChatNodeLike | undefined): ToolMember | undefined {
  const block = node?.data?.root
  if (!block) return undefined
  return {
    key,
    callId: callIdOf(block),
    toolName: callName(block) || 'tool',
    block,
  }
}

/**
 * Role of the node at `index` in an ordered chat list.
 * Followers are consecutive tool-calls after a leader. A run of one stays solo
 * so a single card is not wrapped in a one-item group.
 */
export function roleInRun(
  kinds: readonly (string | undefined)[],
  index: number,
  minimum = MINIMUM_GROUP_SIZE,
): RunRole {
  if (index < 0 || index >= kinds.length) return 'solo'
  if (!isToolCallKind(kinds[index])) return 'solo'
  if (index > 0 && isToolCallKind(kinds[index - 1])) return 'follower'
  let size = 1
  for (let next = index + 1; next < kinds.length; next += 1) {
    if (!isToolCallKind(kinds[next])) break
    size += 1
  }
  return size >= minimum ? 'leader' : 'solo'
}

export function collectRun(
  order: readonly string[],
  nodes: { get(key: string): ChatNodeLike | undefined },
  nodeKey: string,
  minimum = MINIMUM_GROUP_SIZE,
): RunView {
  const kinds = order.map(key => nodes.get(key)?.kind)
  const index = order.indexOf(nodeKey)
  const role = roleInRun(kinds, index, minimum)
  if (role === 'follower' || index < 0) {
    const self = memberFromNode(nodeKey, nodes.get(nodeKey))
    return { role, members: self ? [self] : [] }
  }
  const members: ToolMember[] = []
  for (let cursor = index; cursor < order.length; cursor += 1) {
    if (!isToolCallKind(kinds[cursor])) break
    const key = order[cursor]
    if (!key) continue
    const member = memberFromNode(key, nodes.get(key))
    if (member) members.push(member)
  }
  return { role, members }
}

export function tallyRoles(
  kinds: readonly (string | undefined)[],
  minimum = MINIMUM_GROUP_SIZE,
): { solo: number; leader: number; follower: number } {
  const tally = { solo: 0, leader: 0, follower: 0 }
  for (let index = 0; index < kinds.length; index += 1) {
    if (!isToolCallKind(kinds[index])) continue
    tally[roleInRun(kinds, index, minimum)] += 1
  }
  return tally
}
