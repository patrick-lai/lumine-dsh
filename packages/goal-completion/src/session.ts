/**
 * Session-shape helpers. Lumine ACP sessions are identified by picker preset
 * or a bound official ACP child id. DeepSeek / standard sessions stay off
 * the marker fallback.
 */

export const LUMINE_ACP_PRESETS = ['claude-code', 'codex', 'cursor', 'grok-build'] as const

export const ROUND_DRIVER_IDS = [
  'goal-round-driver',
  '@deepseek-ai/dsh-goal-round-driver',
  'dsh-goal-round-driver',
] as const

export interface SessionLike {
  header?: { agentPreset?: string }
  events?: ReadonlyArray<{ type: string; data?: unknown }>
}

export function isLumineAcpPreset(preset: string | undefined): boolean {
  return typeof preset === 'string' && (LUMINE_ACP_PRESETS as readonly string[]).includes(preset)
}

export function lastBoundAcpSession(events: ReadonlyArray<{ type: string; data?: unknown }> | undefined): string | undefined {
  if (!events) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'request/context' && event?.type !== 'lumine-acp/bound') continue
    const data = event.data as { acpSessionId?: unknown } | undefined
    if (typeof data?.acpSessionId === 'string' && data.acpSessionId) return data.acpSessionId
  }
  return undefined
}

export function isLumineAcpSession(session: SessionLike | undefined): boolean {
  if (!session) return false
  if (isLumineAcpPreset(session.header?.agentPreset)) return true
  return lastBoundAcpSession(session.events) !== undefined
}

/**
 * Whether this session's own composition mounted an enabled round-driver.
 * Host-plane registry presence is NOT consulted — that was a one-shot global
 * veto that killed ACP fallback on every stock DSH host.
 */
export function agentScopedRoundDriverEnabled(ctx: {
  fiber?: { children?: Array<{ name?: string; disabled?: boolean }> }
  runtime?: { name?: string }
} | undefined): boolean {
  if (!ctx) return false
  for (const child of ctx.fiber?.children ?? []) {
    if (child.disabled) continue
    if (typeof child.name === 'string' && isRoundDriverId(child.name)) return true
  }
  return typeof ctx.runtime?.name === 'string' && isRoundDriverId(ctx.runtime.name)
}

function isRoundDriverId(id: string): boolean {
  return (ROUND_DRIVER_IDS as readonly string[]).includes(id)
}

/**
 * ACP harvest mounts only on lumine ACP sessions, and only when that
 * session's composition did not also mount the round-driver.
 */
export function canMountAcpFallback(input: {
  readonly sessionIsLumineAcp: boolean
  readonly roundDriverPresent: boolean
}): boolean {
  return input.sessionIsLumineAcp && !input.roundDriverPresent
}

function pushId(ids: string[], value: unknown): void {
  if (typeof value === 'string' && value) ids.push(value)
  else if (value && typeof value === 'object' && 'name' in value) {
    const name = (value as { name?: unknown }).name
    if (typeof name === 'string' && name) ids.push(name)
  }
}

export function collectPluginIds(ctx: {
  registry?: { keys?: () => Iterable<unknown>; forEach?: (callback: (value: unknown, key: unknown) => void) => void }
  fiber?: { children?: Array<{ name?: string }> }
  runtime?: { name?: string; parent?: { name?: string } }
}): string[] {
  const ids: string[] = []
  const registry = ctx.registry
  if (registry?.keys) {
    for (const key of registry.keys()) pushId(ids, key)
  }
  if (registry?.forEach) {
    registry.forEach((value, key) => {
      pushId(ids, key)
      pushId(ids, value)
    })
  }
  for (const child of ctx.fiber?.children ?? []) pushId(ids, child)
  pushId(ids, ctx.runtime?.name)
  pushId(ids, ctx.runtime?.parent?.name)
  return ids
}

export function hasRoundDriver(ctx: Parameters<typeof collectPluginIds>[0]): boolean {
  const ids = collectPluginIds(ctx)
  return ids.some(id => isRoundDriverId(id))
}

function contentBlocksText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const record = block as { type?: string; text?: string }
      if (typeof record.text !== 'string') return ''
      if (record.type === 'text' || record.type === undefined) return record.text
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function assistantMessageText(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const record = data as { message?: { content?: unknown }; content?: unknown }
  const fromMessage = contentBlocksText(record.message?.content)
  if (fromMessage) return fromMessage
  return contentBlocksText(record.content)
}

function eventTurn(data: unknown): number | undefined {
  if (!data || typeof data !== 'object') return undefined
  const turn = (data as { turn?: unknown }).turn
  return typeof turn === 'number' ? turn : undefined
}

function lastTurnNumber(events: ReadonlyArray<{ type: string; data?: unknown }>): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const turn = eventTurn(events[index]?.data)
    if (turn !== undefined) return turn
  }
  return undefined
}

/** Published ACP `assistant/chunk` text-deltas for one turn (`TurnProjector`). */
function foldTextDeltas(events: ReadonlyArray<{ type: string; data?: unknown }>, turn: number): string {
  const parts: string[] = []
  for (const event of events) {
    if (event.type !== 'assistant/chunk') continue
    const data = event.data as { turn?: number; chunk?: { type?: string; text?: string } } | undefined
    if (data?.turn !== turn) continue
    if (data.chunk?.type === 'text-delta' && typeof data.chunk.text === 'string') {
      parts.push(data.chunk.text)
    }
  }
  return parts.join('')
}

/**
 * Last settled assistant text. Prefer `assistant/message` `{ turn, step, message }`
 * (published DSH / ACP `TurnProjector.finish`). If that message has no text
 * blocks, fold the same turn's `assistant/chunk` `{ type: 'text-delta' }` parts
 * so a chunk-only ACP log still exposes line-start `GOAL REACHED`.
 */
export function lastAssistantReply(
  eventsOrSession: ReadonlyArray<{ type: string; data?: unknown }> | SessionLike | undefined,
): string | undefined {
  const events = Array.isArray(eventsOrSession)
    ? eventsOrSession
    : eventsOrSession?.events
  if (!events) return undefined
  let lastMessage: { type: string; data?: unknown } | undefined
  for (const event of events) {
    if (event.type === 'assistant/message') lastMessage = event
  }
  if (lastMessage) {
    const text = assistantMessageText(lastMessage.data)
    if (text.trim()) return text
    const turn = eventTurn(lastMessage.data)
    if (turn !== undefined) {
      const folded = foldTextDeltas(events, turn)
      if (folded.trim()) return folded
    }
  }
  const turn = lastTurnNumber(events)
  if (turn !== undefined) {
    const folded = foldTextDeltas(events, turn)
    if (folded.trim()) return folded
  }
  return undefined
}

export function turnEndKind(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const reason = (data as { reason?: { kind?: string } }).reason
  return typeof reason?.kind === 'string' ? reason.kind : undefined
}

export function isPluginNoticeSource(source: unknown): boolean {
  if (!source || typeof source !== 'object') return false
  const record = source as { kind?: string; plugin?: string }
  return record.kind === 'plugin' && record.plugin === 'lumine-goal-completion'
}
