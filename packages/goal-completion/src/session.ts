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
  return ids.some(id => (ROUND_DRIVER_IDS as readonly string[]).includes(id))
}

export function lastAssistantReply(events: ReadonlyArray<{ type: string; data?: unknown }> | undefined): string | undefined {
  if (!events) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    const data = event.data as { message?: { content?: Array<{ type?: string; text?: string }> } } | undefined
    const blocks = data?.message?.content ?? []
    const text = blocks
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string)
      .join('\n')
    if (text) return text
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
