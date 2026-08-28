import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type {
  AgentFactory,
  AgentHandle,
  AgentOptions,
  AgentSetup,
  CreateAgentOptions,
  ResumeAgentOptions,
  SessionStartSource,
} from '@deepseek-ai/dsh-agent'
import { emitAgentEvent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { SessionPreparation } from '@deepseek-ai/dsh-session'
import { AcpSessionAgent } from './agent.ts'
import type { ResolvedConfig } from './config.ts'
import { AcpCatalogRegistry } from './models.ts'
import { resolveProviderId, type ProviderId } from './providers.ts'

// @deepseek-ai/cordis exports `const enum FiberState` (PENDING=0 … UNLOADING=5).
// Const enums are erased — the published JS has no runtime `FiberState` export.
const FIBER_FAILED = 3
const FIBER_DISPOSED = 4
const FIBER_UNLOADING = 5

const INACTIVE = new Set<number>([
  FIBER_UNLOADING,
  FIBER_DISPOSED,
  FIBER_FAILED,
])

class FactoryOwnership {
  private accepting = true
  private readonly teardown = new AbortController()
  private readonly live = new Set<() => Promise<void>>()
  private readonly startup = new Set<Promise<void>>()

  constructor(private readonly fiber: Context['fiber']) {}

  get signal(): AbortSignal {
    return this.teardown.signal
  }

  isActive(): boolean {
    return this.accepting && !INACTIVE.has(this.fiber.state)
  }

  track(dispose: () => Promise<void>): () => void {
    this.live.add(dispose)
    return () => { this.live.delete(dispose) }
  }

  trackWrapper(job: Promise<unknown>): void {
    const wrapped = job.then(() => undefined, () => undefined)
    this.startup.add(wrapped)
    const forget = (): void => { this.startup.delete(wrapped) }
    void wrapped.then(forget, forget)
  }

  async dispose(): Promise<void> {
    this.accepting = false
    this.teardown.abort(new Error('ACP session factory is not active'))
    await Promise.all([
      ...[...this.live].map(dispose => dispose()),
      ...this.startup,
    ])
  }
}

interface PreparedAgent {
  agent: AcpSessionAgent
  signal: AbortSignal
  publish: (source: SessionStartSource) => AgentHandle
  dispose: () => Promise<void>
}

function raceAbort<T>(operation: PromiseLike<T> | T, signal: AbortSignal, id: SessionId): Promise<T> {
  const toError = (): Error => signal.reason instanceof Error
    ? signal.reason
    : new Error(`agent "${id}" creation aborted`, { cause: signal.reason })
  if (signal.aborted) return Promise.reject(toError())
  const aborted = Promise.withResolvers<never>()
  const onAbort = (): void => { aborted.reject(toError()) }
  signal.addEventListener('abort', onAbort, { once: true })
  return Promise.race([Promise.resolve(operation), aborted.promise]).finally(() => {
    signal.removeEventListener('abort', onAbort)
  })
}

async function raceAbortCall<T>(
  operation: () => PromiseLike<T> | T,
  signal: AbortSignal,
  id: SessionId,
  releaseAbandoned?: (value: T) => void,
): Promise<T> {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error(`agent "${id}" creation aborted`, { cause: signal.reason })
  }
  const pending = Promise.resolve().then(operation)
  try {
    return await raceAbort(pending, signal, id)
  } catch (error: unknown) {
    if (signal.aborted && releaseAbandoned !== undefined) {
      void pending.then(releaseAbandoned, () => undefined)
    }
    throw error
  }
}

export class LumineAcpFactory extends Service implements AgentFactory {
  static inject = ['agents', 'sessions', 'llm']

  private readonly ownership: FactoryOwnership
  private readonly runtime: { ctx: Context }
  private readonly catalog: AcpCatalogRegistry

  constructor(ctx: Context, readonly resolved: ResolvedConfig) {
    super(ctx, 'lumineAcpSession')
    this.ownership = new FactoryOwnership(ctx.fiber)
    this.runtime = { ctx }
    this.catalog = new AcpCatalogRegistry(ctx.get('llm') as ConstructorParameters<typeof AcpCatalogRegistry>[0])
    ctx.effect(() => () => this.ownership.dispose(), 'lumineAcpSession.transactions()')
    ctx.effect(() => ctx.agents.setFactory(this), 'lumineAcpSession.setFactory()')
  }

  providerFor(session: Session, options: AgentOptions | undefined): ProviderId {
    return resolveProviderId({
      preset: session.header.agentPreset,
      provider: options?.provider,
      fallback: this.resolved.defaultProvider,
    })
  }

  private prepare(
    ownerCtx: Context,
    id: SessionId,
    options: AgentOptions,
    session: Session,
    callerSignal?: AbortSignal,
  ): PreparedAgent {
    ownerCtx.fiber.assertActive()
    if (!this.ownership.isActive()) throw new Error('ACP session factory is not active')
    if (callerSignal?.aborted) {
      throw callerSignal.reason instanceof Error
        ? callerSignal.reason
        : new Error(`agent "${id}" creation aborted`, { cause: callerSignal.reason })
    }

    const abort = new AbortController()
    const onCallerAbort = (): void => {
      abort.abort(callerSignal?.reason instanceof Error
        ? callerSignal.reason
        : new Error(`agent "${id}" creation aborted`, { cause: callerSignal?.reason }))
    }
    const onFactoryTeardown = (): void => { abort.abort(this.ownership.signal.reason) }
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
    this.ownership.signal.addEventListener('abort', onFactoryTeardown, { once: true })

    let machine: AcpSessionAgent | undefined
    let detachSession: (() => void) | undefined
    let detachAgent: (() => void) | undefined
    let disposing: Promise<void> | undefined
    const machineReady = Promise.withResolvers<void>()

    const dispose = (ownerTriggered = false): Promise<void> => (disposing ??= (async () => {
      abort.abort(new Error(`agent "${id}" lifecycle disposed`))
      callerSignal?.removeEventListener('abort', onCallerAbort)
      this.ownership.signal.removeEventListener('abort', onFactoryTeardown)
      try {
        if (machine === undefined) await machineReady.promise
        if (machine !== undefined) {
          machine.cancel({ kind: 'disposed' })
          await machine.whenIdle()
          await machine.disposeChild()
          await machine.scope.dispose()
        }
      } finally {
        try {
          detachAgent?.()
          detachSession?.()
        } finally {
          untrack()
          if (!ownerTriggered) await unfollowOwner()
        }
      }
    })())

    const untrack = this.ownership.track(dispose)
    let unfollowOwner: () => Promise<void> | void
    try {
      unfollowOwner = ownerCtx.effect(() => () => {
        if (disposing !== undefined) return
        abort.abort(new Error(`agent "${id}" setup aborted: owner disposed during setup`))
        return dispose(true)
      }, `lumineAcpSession.lifecycle(${id})`)
    } catch (error: unknown) {
      untrack()
      callerSignal?.removeEventListener('abort', onCallerAbort)
      this.ownership.signal.removeEventListener('abort', onFactoryTeardown)
      throw error
    }

    const assertLive = (): void => {
      if (!abort.signal.aborted) return
      throw abort.signal.reason instanceof Error ? abort.signal.reason : new Error(String(abort.signal.reason))
    }

    try {
      const provider = this.providerFor(session, options)
      const agent = machine = new AcpSessionAgent(
        this.runtime.ctx,
        id,
        { ...options, provider },
        session,
        provider,
        this.resolved,
        this.catalog,
      )
      machineReady.resolve()
      assertLive()
      return {
        agent,
        signal: abort.signal,
        publish: (source) => {
          assertLive()
          detachSession = agent.ctx.sessions.enter(session)
          detachAgent = this.runtime.ctx.agents.enter(agent, ownerCtx.agent)
          agent.ctx.sessions.announce(session)
          assertLive()
          this.runtime.ctx.agents.announce(agent)
          assertLive()
          emitAgentEvent(this.runtime.ctx, agent, 'agent/session-start', { source })
          assertLive()
          return { agent, dispose }
        },
        dispose,
      }
    } catch (error: unknown) {
      machineReady.resolve()
      void dispose()
      throw error
    }
  }

  private async setupAndPublish(
    ownerCtx: Context,
    id: SessionId,
    preparation: SessionPreparation,
    agentOptions: AgentOptions,
    setup: AgentSetup | undefined,
    signal: AbortSignal | undefined,
    source: SessionStartSource,
  ): Promise<AgentHandle> {
    using ownedPreparation = preparation
    const session = ownedPreparation.session
    const prepared = this.prepare(ownerCtx, id, agentOptions, session, signal)
    try {
      const setupCommit = await raceAbort(setup?.(prepared.agent.ctx), prepared.signal, id)
      setupCommit?.commit()
      await raceAbort(prepared.agent.bindOfficialChild(), prepared.signal, id)
      return prepared.publish(source)
    } catch (error: unknown) {
      await prepared.dispose()
      throw error
    }
  }

  async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
    const preparation = SessionPreparation.create(this.runtime.ctx.sessions.prepare(options.sessionId, {
      ...options.seed === undefined ? {} : { seed: options.seed },
      ...options.meta === undefined ? {} : { meta: options.meta },
    }))
    const published = this.setupAndPublish(
      ownerCtx,
      options.sessionId,
      preparation,
      options.agentOptions ?? {},
      options.setup,
      options.signal,
      'startup',
    )
    this.ownership.trackWrapper(published)
    return published
  }

  async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle> {
    const persistence = this.runtime.ctx.get('sessionPersistence') as
      | { prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation> }
      | undefined
    if (persistence === undefined) {
      throw new Error('cannot resume: session persistence is not configured (load a dsh-session-persistence backend)')
    }
    const id = options.resumeSessionId
    const published = (async () => {
      const ownerAbort = new AbortController()
      const unfollowOwner = ownerCtx.effect(() => () => {
        ownerAbort.abort(new Error(`agent "${id}" setup aborted: owner disposed during setup`))
      }, `lumineAcpSession.resume-load(${id})`)
      const fused = AbortSignal.any([
        ...options.signal === undefined ? [] : [options.signal],
        ownerAbort.signal,
        this.ownership.signal,
      ])
      let preparation: SessionPreparation | undefined
      try {
        try {
          preparation = await raceAbortCall(
            () => persistence.prepare(id, fused),
            fused,
            id,
            abandoned => { abandoned[Symbol.dispose]() },
          )
        } finally {
          await unfollowOwner()
        }
        ownerCtx.fiber.assertActive()
        if (!this.ownership.isActive()) throw new Error('ACP session factory is not active')
        return await this.setupAndPublish(
          ownerCtx,
          id,
          preparation,
          options.agentOptions ?? {},
          options.setup,
          options.signal,
          'resume',
        )
      } finally {
        preparation?.[Symbol.dispose]()
      }
    })()
    this.ownership.trackWrapper(published)
    return published
  }
}
