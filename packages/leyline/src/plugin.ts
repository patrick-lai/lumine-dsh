/**
 * Leyline host adapter for DeepSeek Harness.
 *
 * Talks to an already-running Leyline daemon over HTTP. Fire-and-forget:
 * a memory miss never fails session.create or session.prompt.
 *
 * Loaded via `src/index.ts` after DSH peers are linked. Do not import this
 * file from the package `main` until `ensureDshPeers()` has run.
 *
 * @module @lumine/dsh-leyline
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  FEATURE_CONTEXT_PACK,
  FEATURE_LIFECYCLE,
  FEATURE_MATERIALIZE,
  FEATURE_SESSION_EVENTS,
} from './capabilities.ts'
import { LeylineClient } from './client.ts'
import { resolveConfig, type Config, type ResolvedConfig } from './config.ts'
import { digestSession } from './digest.ts'
import {
  buildContextPackRequest,
  buildLifecycleEvent,
  buildMaterializeRequest,
  buildSessionEventsPayload,
  compileRecall,
  type ContextPackResponse,
  type LifecycleKind,
} from './payloads.ts'
import { isAbsoluteGitRoot, repoIdFromGitRoot, workspaceQuery } from './workspace.ts'
import { ensureDshPeers, DSH_PEERS } from './peers.ts'

export const name = 'lumine-leyline'
export const inject = ['agents', 'sessions']

export type { Config } from './config.ts'
export { resolveConfig, SOURCE_CLIENT_ID, DEFAULT_BASE_URL } from './config.ts'
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
export { digestSession } from './digest.ts'
export { isAbsoluteGitRoot, canonicalizeRepoId, repoIdFromGitRoot } from './workspace.ts'
export { ensureDshPeers, DSH_PEERS }

interface LiveSession {
  packed: boolean
  settled: boolean
  packing: boolean
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

function payloadRecord(...args: unknown[]): Record<string, unknown> {
  for (const arg of args) {
    if (arg && typeof arg === 'object' && !Array.isArray(arg)) return arg as Record<string, unknown>
  }
  return {}
}

function userQuery(session: Session): string {
  for (const event of session.events) {
    if (event.type !== 'user/message') continue
    const data = event.data as { message?: { content?: Array<{ type?: string; text?: string }> }; text?: string }
    if (typeof data?.text === 'string' && data.text.trim()) return data.text.trim()
    const blocks = data?.message?.content ?? []
    const text = blocks
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string)
      .join('\n')
      .trim()
    if (text) return text
  }
  return workspaceQuery(session.header.cwd)
}

export class LumineLeylineHost extends Service {
  static inject = ['agents', 'sessions']

  readonly resolved: ResolvedConfig
  readonly client: LeylineClient
  private readonly live = new Map<string, LiveSession>()

  constructor(ctx: Context, options: ResolvedConfig & { client?: LeylineClient }) {
    super(ctx, 'lumineLeyline')
    this.resolved = {
      baseUrl: options.baseUrl,
      materialize: options.materialize,
      maxMemories: options.maxMemories,
      maxTokens: options.maxTokens,
      workspaceId: options.workspaceId,
      timeoutMs: options.timeoutMs,
    }
    this.client = options.client ?? new LeylineClient({
      baseUrl: this.resolved.baseUrl,
      timeoutMs: this.resolved.timeoutMs,
    })
    this.forget(this.client.probe())
    ctx.effect(() => {
      const offStart = ctx.on('agent/session-start', (...args: unknown[]) => {
        const agent = asAgent(...args)
        if (agent) this.forget(this.onSessionStart(agent))
      })
      const offStatus = ctx.on('agent/status', (...args: unknown[]) => {
        const agent = asAgent(...args)
        const payload = payloadRecord(...args)
        if (agent && payload.status === 'running') this.forget(this.onFirstPrompt(agent))
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
      return () => {
        offStart?.()
        offStatus?.()
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
    const created: LiveSession = { packed: false, settled: false, packing: false, recallIds: [] }
    this.live.set(id, created)
    return created
  }

  private async ensureFeatures(): Promise<void> {
    if (!this.client.capabilities.ready) await this.client.probe()
  }

  async onSessionStart(agent: Agent): Promise<void> {
    try {
      await this.ensureFeatures()
      await this.recallAndMaybeMaterialize(agent)
    } catch {
      // Fire-and-forget: daemon-down stays silent and healthy.
    }
  }

  async onFirstPrompt(agent: Agent): Promise<void> {
    const state = this.state(String(agent.id))
    if (state.packed || state.packing) return
    try {
      await this.ensureFeatures()
      await this.recallAndMaybeMaterialize(agent)
    } catch {
      // no-op
    }
  }

  async onSessionEnd(agent: Agent): Promise<void> {
    const id = String(agent.id)
    const state = this.state(id)
    if (state.settled) return
    state.settled = true
    try {
      await this.ensureFeatures()
      if (!this.client.capabilities.supports(FEATURE_SESSION_EVENTS)) return
      const digest = digestSession(agent.session, state.recallIds)
      const cwd = agent.session.header.cwd
      const payload = buildSessionEventsPayload({
        sourceSessionId: id,
        workspaceId: this.resolved.workspaceId,
        workspacePath: cwd,
        repoId: cwd && isAbsoluteGitRoot(cwd) ? repoIdFromGitRoot(cwd) : undefined,
        title: agent.session.header.agentPreset,
        startedAt: digest.startedAt,
        settledAt: digest.settledAt,
        digest: digest.digest,
        tail: digest.tail,
        durationSeconds: digest.durationSeconds,
        agent: digest.agent,
        receipt: digest.receipt,
        toolOutcomes: digest.toolOutcomes,
      })
      await this.client.post('/v1/session/events', payload)
    } catch {
      // no-op
    } finally {
      this.live.delete(id)
    }
  }

  private async recallAndMaybeMaterialize(agent: Agent): Promise<void> {
    const state = this.state(String(agent.id))
    if (state.packed || state.packing) return
    state.packing = true
    try {
      const cwd = agent.session.header.cwd
      const repoId = cwd && isAbsoluteGitRoot(cwd) ? repoIdFromGitRoot(cwd) : undefined
      if (this.client.capabilities.supports(FEATURE_CONTEXT_PACK)) {
        const request = buildContextPackRequest({
          query: userQuery(agent.session),
          workspaceId: this.resolved.workspaceId,
          repoId,
          maxMemories: this.resolved.maxMemories,
          maxTokens: this.resolved.maxTokens,
        })
        const pack = await this.client.post('/v1/context-pack', request) as ContextPackResponse | undefined
        const compiled = compileRecall(pack)
        state.recallIds = compiled.recallIds
        this.tryHiddenHostContext(agent, compiled.text)
      }
      if (
        this.resolved.materialize
        && this.client.capabilities.supports(FEATURE_MATERIALIZE)
        && isAbsoluteGitRoot(cwd)
      ) {
        await this.client.post('/v1/materialize', buildMaterializeRequest({
          path: cwd,
          workspaceId: this.resolved.workspaceId,
          repoId,
        }))
      }
      state.packed = true
    } finally {
      state.packing = false
    }
  }

  /**
   * ACP sessions replace agent-loop; the official child owns tools and never
   * sees `ctx.systemPrompt` or `agent/pre-step` inbox splices. Registering a
   * prompt section is the native-loop seam when that service exists. It is
   * not a second agent-loop and it is not a user bubble. ACP v1 injection is
   * opt-in materialize of `.leyline/LESSONS.md`.
   */
  private tryHiddenHostContext(agent: Agent, text: string): void {
    if (!text) return
    const systemPrompt = agent.ctx.get('systemPrompt') as Context['systemPrompt'] | undefined
      ?? this.ctx.get('systemPrompt') as Context['systemPrompt'] | undefined
    try {
      systemPrompt?.section({
        name: 'lumine-leyline-recall',
        order: 40,
        text,
      })
    } catch {
      // Missing or inactive service — degrade. Capture still happens.
    }
  }

  async reportLifecycle(kind: LifecycleKind, extras: {
    repoId?: string
    branch?: string
    worktreePath?: string
  } = {}): Promise<void> {
    try {
      await this.ensureFeatures()
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
      repoId: path && isAbsoluteGitRoot(path) ? repoIdFromGitRoot(path) : undefined,
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
          repoId: path && isAbsoluteGitRoot(path) ? repoIdFromGitRoot(path) : undefined,
          worktreePath: path,
        }))
      }
      return removed
    }
    return () => { registry.delete = original }
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  ctx.plugin(LumineLeylineHost, resolved)
}

export default {
  name,
  inject,
  apply,
}
