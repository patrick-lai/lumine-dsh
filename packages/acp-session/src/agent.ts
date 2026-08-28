import type { Context } from '@deepseek-ai/cordis'
import {
  Inbox,
  emitAgentEvent,
  type Agent,
  type AgentOptions,
  type AgentStatus,
  type CancelOptions,
  type InboxTarget,
} from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { AgentCancelCause, Session, SessionId } from '@deepseek-ai/dsh-session'
import { AcpChild } from './client.ts'
import type { ResolvedConfig } from './config.ts'
import {
  TurnProjector,
  hasRequestHeader,
  lastBoundAcpSession,
  userMessageText,
  type LogOp,
} from './events.ts'
import {
  fallbackCatalog,
  lastModelSelection,
  projectAcpModels,
  seedSessionRoute,
  selectionEquals,
  type AcpCatalogRegistry,
  type HostModelSelection,
  type ProjectedCatalog,
} from './models.ts'
import { MissingCliError, resolveLaunch, type ProviderId } from './providers.ts'

type Phase =
  | { kind: 'idle'; lastTurn: number }
  | { kind: 'maintenance'; abort: AbortController; lastTurn: number; wakeRequested: boolean }
  | { kind: 'running'; abort: AbortController; turn: number; step: number; wakeRequested: boolean }

function appendOp(session: Session, op: LogOp): number {
  const event = op.surface
    ? session.append(op.type, op.data, { surfaceOp: 'append', ...op.sourceEventSeqs ? { sourceEventSeqs: op.sourceEventSeqs } : {} })
    : session.append(op.type, op.data)
  return event.seq
}

function nextTurnNumber(session: Session): number {
  const last = [...session.events].reverse().find(event => event.type === 'turn/start')
  const data = last?.data as { turn?: number } | undefined
  return (data?.turn ?? 0) + 1
}

/**
 * Agent whose driver is one long-lived official CLI over ACP.
 * Consumers only call followup / cancel / whenIdle — the product owns tools.
 */
export class AcpSessionAgent implements Agent {
  readonly inbox: Inbox
  readonly scope: Scope
  readonly ctx: Context
  private phase: Phase
  private activityDone: Promise<void> = Promise.resolve()
  private child: AcpChild | undefined
  private headerLogged = false
  private lastWrittenSelection: HostModelSelection | undefined
  private bound = false

  constructor(
    private readonly loopCtx: Context,
    readonly id: SessionId,
    readonly options: AgentOptions,
    readonly session: Session,
    readonly provider: ProviderId,
    private readonly config: ResolvedConfig,
    private readonly catalog: AcpCatalogRegistry,
  ) {
    this.inbox = new Inbox(session, {
      inserted: () => {},
      discarded: () => {},
      claimed: () => {},
    })
    this.phase = { kind: 'idle', lastTurn: nextTurnNumber(session) - 1 }
    this.scope = createScope(loopCtx, this)
    this.ctx = this.scope.ctx.extend({ agent: this })
    this.interceptSelectionWrites()
    this.adoptSeedRoute()
    this.loopCtx.on('session/event', (subject, event) => {
      const session = subject as Session
      const row = event as { type?: string; data?: unknown }
      if (session.id !== this.session.id) return
      if (row.type !== 'model/selection') return
      this.noteHostSelection(row.data as HostModelSelection)
    })
  }

  private interceptSelectionWrites(): void {
    const session = this.session
    const append = session.append.bind(session)
    const intercepted = ((type: string, data: unknown, opts?: Parameters<Session['append']>[2]) => {
      const event = opts === undefined ? append(type, data) : append(type, data, opts)
      if (type === 'model/selection') this.noteHostSelection(data as HostModelSelection)
      return event
    }) as Session['append']
    try {
      Object.defineProperty(session, 'append', { configurable: true, value: intercepted })
    } catch {
      // Frozen Session objects still notify via session/event.
    }
  }

  private noteHostSelection(incoming: HostModelSelection | undefined): void {
    if (!incoming || selectionEquals(this.lastWrittenSelection, incoming)) return
    this.lastWrittenSelection = incoming
    void this.mirrorHostSelection(incoming)
  }

  private currentCatalog(): ProjectedCatalog {
    return this.catalog.adapter.projected(this.provider) ?? fallbackCatalog(this.provider)
  }

  private currentRoute(): { provider: ProviderId; model: string } {
    const selected = lastModelSelection(this.session.events)
    if (selected?.provider === this.provider) {
      return { provider: this.provider, model: selected.model }
    }
    return { provider: this.provider, model: this.currentCatalog().currentModel }
  }

  /**
   * Host `session.create` setup calls `selectionFor()` *before*
   * `bindOfficialChild()`. That first call freezes `picked` from
   * `model/selection` pending (or falls through to `agent-default-model` =
   * deepseek-official / deepseek-v4-flash). Write the ACP product's row now.
   *
   * `request/header` is turn-enclosed by the session invariant, so it cannot
   * move `current` before the first prompt. `agentDefaultModel.saveSelection`
   * is best-effort (needs the settings provider).
   */
  private adoptSeedRoute(): void {
    this.publishCatalog(this.currentCatalog())
  }

  private writeSelection(catalog: ProjectedCatalog): void {
    const next = seedSessionRoute(this.session, catalog)
    this.lastWrittenSelection = next
    this.adoptHostDefault(next)
  }

  private adoptHostDefault(selection: HostModelSelection): void {
    const defaults = (this.loopCtx.agentDefaultModel ?? this.loopCtx.get('agentDefaultModel')) as {
      currentSelection?: () => HostModelSelection
      saveSelection?: (next: HostModelSelection) => Promise<void>
    } | undefined
    if (defaults?.saveSelection === undefined) return
    const current = defaults.currentSelection?.()
    if (current && selectionEquals(current, selection)) return
    void Promise.resolve(defaults.saveSelection(selection)).catch((error: unknown) => {
      this.loopCtx.logger.warn(
        `lumine-acp-session: agent-default-model not saved: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }

  private publishCatalog(catalog: ProjectedCatalog): void {
    this.catalog.publish(catalog)
    this.writeSelection(catalog)
  }

  private async mirrorHostSelection(selection: HostModelSelection | undefined): Promise<void> {
    if (!selection || selection.provider !== this.provider) return
    const child = this.child
    if (child === undefined) return
    try {
      await child.applyHostSelection(this.provider, selection)
      this.catalog.publish(child.projectCatalog(this.provider))
    } catch (error: unknown) {
      this.loopCtx.logger.warn(
        `lumine-acp-session: session/set_config_option failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Start the official CLI at session create so the web picker sees this
   * product's models before the first prompt.
   */
  async bindOfficialChild(): Promise<void> {
    if (this.bound) return
    this.bound = true
    this.publishCatalog(fallbackCatalog(this.provider))
    try {
      const child = await this.ensureChild()
      child.onConfigOptions = (payload) => {
        this.catalog.publish(projectAcpModels(this.provider, payload))
      }
      const sessionId = await child.ensure()
      this.publishCatalog(child.projectCatalog(this.provider))
      if (!lastBoundAcpSession(this.session.events)) {
        const route = this.currentRoute()
        this.session.append('request/context', {
          provider: route.provider,
          model: route.model,
          acpSessionId: sessionId,
        })
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.loopCtx.logger.warn(`lumine-acp-session: official CLI not ready at session start: ${message}`)
    }
  }

  get status(): AgentStatus {
    return this.phase.kind === 'idle' || this.phase.kind === 'maintenance' ? 'idle' : 'running'
  }

  private setPhase(next: Phase): void {
    const previous = this.status
    this.phase = next
    if (this.status !== previous) {
      emitAgentEvent(this.loopCtx, this, 'agent/status', { status: this.status })
    }
  }

  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
    const wakingAfterAbort = wakeup && this.phase.kind !== 'idle' && this.phase.abort.signal.aborted
    this.inbox.splice(wakingAfterAbort ? 'next-turn' : target, Infinity, 0, [message])
    if (wakeup) this.wakeDriver(wakingAfterAbort)
  }

  followup(message: UserMessage): void {
    this.send(message, 'next-turn', true)
  }

  steer(message: UserMessage): void {
    this.send(message, 'next-step', true)
  }

  inject(message: UserMessage): void {
    this.send(message, 'next-step', false)
  }

  cancel(cause: AgentCancelCause, options: CancelOptions = {}): void {
    if (!options.keepInbox) {
      this.inbox.clear()
      if (this.phase.kind !== 'idle') this.phase.wakeRequested = false
    }
    if (this.phase.kind !== 'idle') this.phase.abort.abort(cause)
    this.child?.cancel()
  }

  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.phase.kind !== 'idle') throw new Error(`agent "${this.id}" already has active work`)
    const done = Promise.withResolvers<void>()
    const maintenance: Phase = {
      kind: 'maintenance',
      abort: new AbortController(),
      lastTurn: this.phase.lastTurn,
      wakeRequested: false,
    }
    this.setPhase(maintenance)
    this.activityDone = done.promise
    return (async () => {
      try {
        return await task(maintenance.abort.signal)
      } finally {
        this.setPhase({ kind: 'idle', lastTurn: maintenance.lastTurn })
        if (maintenance.wakeRequested && this.inbox.hasPending) this.wakeDriver()
        done.resolve()
      }
    })()
  }

  async whenIdle(): Promise<void> {
    let activity: Promise<void>
    do {
      await (activity = this.activityDone)
    } while (activity !== this.activityDone)
  }

  private wakeDriver(wakeAfterAbort = false): void {
    if (this.phase.kind !== 'idle') {
      const reason = this.phase.abort.signal.reason as AgentCancelCause | undefined
      if (reason?.kind !== 'disposed' && (this.phase.kind === 'maintenance' || wakeAfterAbort)) {
        this.phase.wakeRequested = true
      }
      return
    }
    const driver = Promise.withResolvers<void>()
    this.activityDone = driver.promise
    this.setPhase({
      kind: 'running',
      abort: new AbortController(),
      turn: this.phase.lastTurn,
      step: 0,
      wakeRequested: false,
    })
    this.loopCtx.agents.withInitiator(this, () => this.kick()).then(driver.resolve, driver.reject)
  }

  private async kick(): Promise<void> {
    try {
      while (await this.turn()) {}
    } catch {
      // Failures are written into the session log; the driver stays contained.
    } finally {
      if (this.phase.kind === 'running') {
        const { turn, wakeRequested } = this.phase
        this.setPhase({ kind: 'idle', lastTurn: turn })
        if (wakeRequested && this.inbox.hasPending) this.wakeDriver()
      }
    }
  }

  private cwd(): string {
    const cwd = this.session.header.cwd
    if (cwd && cwd.startsWith('/')) return cwd
    return process.cwd()
  }

  private async ensureChild(): Promise<AcpChild> {
    if (this.child) return this.child
    const launch = resolveLaunch(this.provider, {
      override: this.config.providers[this.provider],
    })
    const child = new AcpChild({
      launch,
      cwd: this.cwd(),
      permission: this.config.permission,
      agent: this,
      approval: this.loopCtx.get('approval') ?? undefined,
      resumeSessionId: lastBoundAcpSession(this.session.events),
    })
    child.onConfigOptions = (payload) => {
      this.catalog.publish(projectAcpModels(this.provider, payload))
    }
    this.child = child
    return child
  }

  private async turn(): Promise<boolean> {
    if (this.phase.kind !== 'running') return false
    const phase = this.phase
    const signal = phase.abort.signal
    const claimed = this.inbox.claim('next-turn', phase.lastTurn + 1)
    if (claimed.length === 0) return false

    const turn = phase.lastTurn + 1
    const step = 1
    phase.turn = turn
    phase.step = step
    const route = this.currentRoute()
    const projector = new TurnProjector(turn, step, route)
    const user = claimed[0]

    try {
      for (const op of projector.startTurn(user)) appendOp(this.session, op)
      if (!this.headerLogged) {
        const reason = hasRequestHeader(this.session.events) ? 'resume' : 'initial'
        for (const op of projector.syntheticHeader(reason)) appendOp(this.session, op)
        this.headerLogged = true
      }

      const child = await this.ensureChild()
      const sessionId = await child.ensure()
      if (!lastBoundAcpSession(this.session.events)) {
        appendOp(this.session, projector.bind(sessionId))
      }
      child.onUpdate = update => {
        for (const op of projector.onUpdate(update)) {
          const seq = appendOp(this.session, op)
          if (op.type === 'assistant/chunk') projector.chunkSeqs.push(seq)
        }
      }

      const text = userMessageText(user)
      const result = await child.prompt([{ type: 'text', text: text || '(empty)' }], signal)
      const aborted = signal.aborted || result.stopReason === 'cancelled'
      for (const op of projector.finish(aborted ? 'aborted' : 'completed')) appendOp(this.session, op)
    } catch (error: unknown) {
      const aborted = signal.aborted
      if (error instanceof MissingCliError) {
        appendOp(this.session, {
          type: 'assistant/chunk',
          data: {
            turn,
            step,
            chunk: { type: 'text-delta', index: 0, text: error.message },
          },
        })
        projector.noteAssistantText(error.message)
        for (const op of projector.finish('error', { message: error.message, code: error.code })) {
          appendOp(this.session, op)
        }
        return false
      }
      const message = error instanceof Error ? error.message : String(error)
      if (!aborted) {
        this.loopCtx.logger.warn(`lumine-acp-session: turn failed: ${message}`)
      }
      for (const op of projector.finish(
        aborted ? 'aborted' : 'error',
        aborted ? undefined : { message, code: 'ACP_TURN' },
      )) {
        appendOp(this.session, op)
      }
      if (aborted) throw error
    }

    if (!this.inbox.hasPending) return false
    phase.abort = new AbortController()
    phase.wakeRequested = false
    phase.step = 0
    return true
  }

  async disposeChild(): Promise<void> {
    const child = this.child
    this.child = undefined
    await child?.dispose()
  }
}
