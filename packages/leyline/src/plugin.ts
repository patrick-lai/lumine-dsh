/**
 * Leyline host adapter for DeepSeek Harness.
 *
 * Publishes `ctx.memorySource` (id: leyline) and talks to the existing
 * Leyline daemon / CLI. Fire-and-forget: a memory miss never fails a turn.
 *
 * Loaded via `src/index.ts` after DSH peers are linked. Named exports only —
 * DSH drops `inject` on a default export.
 *
 * @module @lumine/dsh-leyline
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { FEATURE_LIFECYCLE, FEATURE_MATERIALIZE, FEATURE_SESSION_EVENTS } from './capabilities.ts'
import { leylineRememberDreamer } from './cli.ts'
import { LeylineClient } from './client.ts'
import {
  isAcpSession,
  MIN_RECALL_QUERY_CHARS,
  RECALL_CACHE_MS,
  resolveConfig,
  SOURCE_CLIENT_ID,
  type Config,
  type ResolvedConfig,
} from './config.ts'
import { digestSession, isWorthCapturing } from './digest.ts'
import { discoverLeyline } from './discover.ts'
import { firstUserText, insertAfterFirstUser, recallPrompt, recallUserMessage } from './inject.ts'
import { LeylineMemorySource } from './memory-source.ts'
import {
  buildLifecycleEvent,
  buildMaterializeRequest,
  buildSessionEventsPayload,
  compileRecall,
  type ContextPackResponse,
  type LifecycleKind,
} from './payloads.ts'
import { isAbsoluteGitRoot, repoIdFromCwd } from './workspace.ts'
import { ensureDshPeers, DSH_PEERS } from './peers.ts'

export const name = 'lumine-leyline'
export const inject = ['agents', 'sessions']

export type { Config } from './config.ts'
export {
  resolveConfig,
  SOURCE_CLIENT_ID,
  DEFAULT_BASE_URL,
  MEMORY_SOURCE_ID,
  isAcpSession,
} from './config.ts'
export { CapabilityCache, parseCapabilities, supportsFeature, STANDALONE_CAPABILITIES } from './capabilities.ts'
export {
  FEATURE_CONTEXT_PACK,
  FEATURE_HYGIENE,
  FEATURE_LIFECYCLE,
  FEATURE_MATERIALIZE,
  FEATURE_SESSION_EVENTS,
  FEATURE_SESSION_SIMILARITY,
} from './capabilities.ts'
export { LeylineClient } from './client.ts'
export { scrubSecrets, oneLine, nonEmpty } from './scrub.ts'
export {
  buildContextPackRequest,
  buildLifecycleEvent,
  buildMaterializeRequest,
  buildSessionEventsPayload,
  compileRecall,
  settleIdempotencyKey,
  SESSION_EVENTS_SCHEMA,
  LIFECYCLE_SCHEMA,
  MATERIALIZE_SCHEMA,
} from './payloads.ts'
export { digestSession, isWorthCapturing } from './digest.ts'
export { isAbsoluteGitRoot, canonicalizeRepoId, repoIdFromGitRoot, findGitRoot, repoIdFromCwd } from './workspace.ts'
export { discoverLeyline, candidateBaseUrls, leylineHome } from './discover.ts'
export { LeylineMemorySource } from './memory-source.ts'
export type { MemorySource, MemoryRecallHit } from './memory-source.ts'
export { recallUserMessage, recallPrompt, firstUserText, insertAfterFirstUser, tagSafe } from './inject.ts'
export { ensureDshPeers, DSH_PEERS }

interface LiveSession {
  packedAt?: number
  packedQuery?: string
  settled: boolean
  recallIds: string[]
}

function asAgent(...args: unknown[]): Agent | undefined {
  for (const arg of args) {
    if (!arg || typeof arg !== 'object') continue
    const record = arg as { agent?: unknown; session?: unknown; id?: unknown }
    if (record.agent && typeof record.agent === 'object' && 'session' in (record.agent as object)) {
      return record.agent as Agent
    }
    if ('session' in record && 'id' in record) return arg as Agent
  }
  return undefined
}

interface ToolRegistry {
  register?: (tool: unknown) => unknown
  define?: (tool: unknown) => unknown
  has?: (name: string) => boolean
  list?: () => unknown
  names?: () => unknown
}

function listedToolNames(tools: ToolRegistry | undefined): string[] {
  if (!tools) return []
  const names: string[] = []
  const push = (value: unknown): void => {
    if (typeof value === 'string') names.push(value)
    else if (value && typeof value === 'object' && 'name' in value) names.push(String((value as { name: unknown }).name))
  }
  if (typeof tools.names === 'function') {
    const listed = tools.names()
    if (Array.isArray(listed)) listed.forEach(push)
  }
  if (typeof tools.list === 'function') {
    const listed = tools.list()
    if (Array.isArray(listed)) listed.forEach(push)
  }
  return names
}

/** True when Leyline is already on the host via dsh-mcp-client (`mcp__leyline__*`). */
export function hasLeylineMcp(ctx: Context, tools?: ToolRegistry): boolean {
  if (ctx.get('mcp') || ctx.get('mcpClient') || ctx.get('mcpServers')) return true
  const registry = tools
    ?? (ctx as { tools?: ToolRegistry }).tools
    ?? ctx.get('tools') as ToolRegistry | undefined
  if (typeof registry?.has === 'function') {
    if (registry.has('mcp__leyline__recall') || registry.has('mcp__leyline__remember')) return true
  }
  return listedToolNames(registry).some(name =>
    name.startsWith('mcp__leyline__')
    || name === 'leyline_recall'
    || name === 'leyline_remember',
  )
}

function payloadRecord(...args: unknown[]): Record<string, unknown> {
  for (const arg of args) {
    if (arg && typeof arg === 'object' && !Array.isArray(arg) && !('session' in arg && 'id' in arg)) {
      return arg as Record<string, unknown>
    }
  }
  return {}
}

export class LumineLeylineHost extends Service {
  static inject = ['agents', 'sessions']

  readonly resolved: ResolvedConfig
  client: LeylineClient
  memorySource: LeylineMemorySource | undefined
  private readonly live = new Map<string, LiveSession>()
  private ready: Promise<void>

  constructor(ctx: Context, options: ResolvedConfig & { client?: LeylineClient }) {
    super(ctx, 'lumineLeyline')
    this.resolved = {
      baseUrl: options.baseUrl,
      materialize: options.materialize,
      maxMemories: options.maxMemories,
      maxTokens: options.maxTokens,
      workspaceId: options.workspaceId,
      timeoutMs: options.timeoutMs,
      autoRecall: options.autoRecall,
      sessionEventCapture: options.sessionEventCapture,
      spawnIfMissing: options.spawnIfMissing,
      clientId: options.clientId,
    }
    this.client = options.client ?? new LeylineClient({
      baseUrl: this.resolved.baseUrl ?? 'http://127.0.0.1:6868',
      timeoutMs: this.resolved.timeoutMs,
    })
    this.ready = options.client ? this.client.probe().then(() => undefined) : this.attachDaemon()
    this.forget(this.ready)
    this.memorySource = new LeylineMemorySource(ctx, this)
    ctx.memorySource = this.memorySource
    ctx.effect(() => {
      const offPre = ctx.on('agent/pre-step', (payload: unknown, next?: () => Promise<unknown> | unknown) => {
        return this.onPreStep(payload, next)
      }, { prepend: true })
      const offStop = ctx.on('agent/turn-stopping', (...args: unknown[]) => {
        const agent = asAgent(...args)
        if (agent) this.forget(this.onSessionEnd(agent, args))
      })
      const offDisposed = ctx.on('agent/disposed', (...args: unknown[]) => {
        const agent = asAgent(...args)
        if (agent) this.forget(this.onSessionEnd(agent))
      })
      const offWorkspace = ctx.on('host/workspace-removed', (...args: unknown[]) => {
        this.forget(this.onWorkspaceRemoved(payloadRecord(...args)))
      })
      const offWorktree = ctx.on('host/worktree-deleted', (...args: unknown[]) => {
        this.forget(this.onWorktreeDeleted(payloadRecord(...args)))
      })
      const unwrap = this.wrapWorkspaceDelete(ctx)
      this.registerThinTools(ctx)
      return () => {
        offPre?.()
        offStop?.()
        offDisposed?.()
        offWorkspace?.()
        offWorktree?.()
        unwrap?.()
      }
    }, 'lumineLeyline.listen()')
  }

  private forget(job: Promise<unknown>): void {
    void job.catch(() => undefined)
  }

  private state(id: string): LiveSession {
    const existing = this.live.get(id)
    if (existing) return existing
    const created: LiveSession = { settled: false, recallIds: [] }
    this.live.set(id, created)
    return created
  }

  private async attachDaemon(): Promise<void> {
    const found = await discoverLeyline({
      explicitBaseUrl: this.resolved.baseUrl,
      timeoutMs: this.resolved.timeoutMs,
      spawnIfMissing: this.resolved.spawnIfMissing,
    })
    if (found.baseUrl) {
      this.client = new LeylineClient({
        baseUrl: found.baseUrl,
        timeoutMs: this.resolved.timeoutMs,
      })
    }
    await this.client.probe()
  }

  async onPreStep(payload: unknown, next?: () => Promise<unknown> | unknown): Promise<unknown> {
    const incoming = payload && typeof payload === 'object'
      ? payload as {
        agent?: Agent
        messages?: Array<{ role?: string; source?: { kind?: string }; content?: Array<{ type?: string; text?: string }> }>
        signal?: AbortSignal
      }
      : {}
    const decision = next ? await next() : { kind: 'enter', messages: incoming.messages ?? [] }
    const record = (decision && typeof decision === 'object' ? decision : {}) as {
      kind?: string
      messages?: typeof incoming.messages
    }
    if (record.kind === 'reject') return decision
    if (!this.resolved.autoRecall) return decision
    const agent = incoming.agent
    if (!agent || incoming.signal?.aborted) return decision
    if (isAcpSession(agent.session.header.agentPreset, agent.session.events)) return decision
    const messages = record.messages ?? incoming.messages ?? []
    const query = firstUserText(messages)
    if (query.length < MIN_RECALL_QUERY_CHARS) return decision
    try {
      await this.ready
      const compiled = await this.recallFor(agent, query)
      if (!compiled.text) return decision
      const extra = recallUserMessage(recallPrompt(compiled.text))
      return { ...record, kind: record.kind ?? 'enter', messages: insertAfterFirstUser(messages, extra) }
    } catch {
      return decision
    }
  }

  private async recallFor(agent: Agent, query: string): Promise<{ text: string; recallIds: string[] }> {
    const state = this.state(String(agent.id))
    const now = Date.now()
    if (state.packedAt && state.packedQuery === query && now - state.packedAt < RECALL_CACHE_MS) {
      return { text: '', recallIds: state.recallIds }
    }
    const cwd = agent.session.header.cwd
    const repoId = repoIdFromCwd(cwd)
    const pack = await this.memorySource?.contextPack(query, repoId) as ContextPackResponse | undefined
    const compiled = compileRecall(pack)
    state.recallIds = compiled.recallIds
    state.packedAt = now
    state.packedQuery = query
    if (
      this.resolved.materialize
      && this.client.capabilities.supports(FEATURE_MATERIALIZE)
      && isAbsoluteGitRoot(cwd)
    ) {
      this.forget(this.client.post('/v1/materialize', buildMaterializeRequest({
        path: cwd,
        workspaceId: this.resolved.workspaceId,
        repoId,
      })))
    }
    return compiled
  }

  async onSessionEnd(agent: Agent, rawArgs: unknown[] = []): Promise<void> {
    if (!this.resolved.sessionEventCapture) return
    const payload = payloadRecord(...rawArgs)
    const signal = payload.signal as AbortSignal | undefined
    if (payload.cancelled === true || payload.reason === 'cancelled' || signal?.aborted) return
    const id = String(agent.id)
    const state = this.state(id)
    if (state.settled) return
    try {
      await this.ready
      const digest = digestSession(agent.session, state.recallIds)
      if (!isWorthCapturing(digest)) return
      state.settled = true
      if (this.client.capabilities.supports(FEATURE_SESSION_EVENTS)) {
        const cwd = agent.session.header.cwd
        await this.client.post('/v1/session/events', buildSessionEventsPayload({
          sourceSessionId: id,
          workspaceId: this.resolved.workspaceId,
          workspacePath: cwd,
          repoId: repoIdFromCwd(cwd),
          title: agent.session.header.agentPreset,
          startedAt: digest.startedAt,
          settledAt: digest.settledAt,
          digest: digest.digest,
          tail: digest.tail,
          durationSeconds: digest.durationSeconds,
          agent: digest.agent,
          receipt: digest.receipt,
          toolOutcomes: digest.toolOutcomes,
        }))
      }
      this.forget(leylineRememberDreamer({
        title: digest.goal ?? digest.summary ?? `session ${id}`,
        body: digest.digest,
        workspaceId: this.resolved.workspaceId,
        cwd: agent.session.header.cwd,
      }))
    } catch {
      // no-op
    } finally {
      if (state.settled) this.live.delete(id)
    }
  }

  async reportLifecycle(kind: LifecycleKind, extras: {
    repoId?: string
    branch?: string
    worktreePath?: string
  } = {}): Promise<void> {
    try {
      await this.ready
      if (!this.client.capabilities.supports(FEATURE_LIFECYCLE)) return
      await this.client.post('/v1/lifecycle', buildLifecycleEvent({
        kind,
        workspaceId: this.resolved.workspaceId,
        repoId: extras.repoId,
        branch: extras.branch,
        worktreePath: extras.worktreePath,
      }))
    } catch {
      // no-op
    }
  }

  private async onWorkspaceRemoved(payload: Record<string, unknown>): Promise<void> {
    const path = typeof payload.path === 'string' ? payload.path : undefined
    await this.reportLifecycle('workspace_removed', {
      repoId: repoIdFromCwd(path),
      worktreePath: path,
    })
  }

  private async onWorktreeDeleted(payload: Record<string, unknown>): Promise<void> {
    const path = typeof payload.path === 'string'
      ? payload.path
      : typeof payload.worktreePath === 'string' ? payload.worktreePath : undefined
    await this.reportLifecycle('worktree_deleted', { worktreePath: path })
  }

  private wrapWorkspaceDelete(ctx: Context): (() => void) | undefined {
    const registry = ctx.get('workspaceRegistry') as {
      delete?: (id: string) => Promise<boolean>
      get?: (id: string) => { path?: string } | undefined
    } | undefined
    if (typeof registry?.delete !== 'function') return undefined
    const original = registry.delete.bind(registry)
    registry.delete = async (id: string) => {
      const path = registry.get?.(id)?.path
      const removed = await original(id)
      if (removed) {
        this.forget(this.reportLifecycle('workspace_removed', {
          repoId: repoIdFromCwd(path),
          worktreePath: path,
        }))
      }
      return removed
    }
    return () => { registry.delete = original }
  }

  /**
   * Prefer `leyline serve --stdio` via dsh-mcp-client. Only register four thin
   * tools when no MCP client is mounted.
   */
  private registerThinTools(ctx: Context): void {
    const tools = (ctx as { tools?: ToolRegistry }).tools ?? ctx.get('tools') as ToolRegistry | undefined
    if (hasLeylineMcp(ctx, tools)) return
    const register = tools?.register ?? tools?.define
    if (typeof register !== 'function') return
    const source = this.memorySource
    if (!source) return
    for (const tool of [
      { name: 'leyline_recall', description: 'Recall memories from Leyline.', execute: (input: { query?: string }) => source.recall(String(input.query ?? '')) },
      { name: 'leyline_remember', description: 'Stage a Leyline dreamer note.', execute: (input: { title?: string; body?: string }) => source.remember({ title: String(input.title ?? 'note'), body: String(input.body ?? '') }) },
      { name: 'leyline_mark_useful', description: 'Mark a Leyline recall useful.', execute: (input: { recallId?: string }) => source.markUseful(String(input.recallId ?? '')) },
      { name: 'leyline_context', description: 'Compiled Leyline context pack.', execute: (input: { query?: string }) => source.contextPack(String(input.query ?? '')) },
    ]) {
      try {
        register(tool)
      } catch {
        // Host tool surface unavailable.
      }
    }
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  ctx.plugin(LumineLeylineHost, resolved)
}
