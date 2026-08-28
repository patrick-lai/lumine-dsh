/**
 * Per-session composer catalog. Host `session.models` lists every llm route
 * (DeepSeek + every ACP product we seed). Selecting Claude Code at the top
 * left must not offer Grok / Codex / Cursor / DeepSeek rows the child cannot
 * serve. `session.selectModel` of a foreign provider is `model-unavailable`.
 */

import type { LastModelsStore } from './last-models.ts'
import {
  constrainSessionCatalog,
  fallbackCatalog,
  selectionForAgent,
  selectionSupportedByAgent,
  type AcpCatalogRegistry,
  type HostModelSelection,
  type ProjectedCatalog,
} from './models.ts'
import { PRESET_TO_PROVIDER, PROVIDER_LABEL, isProviderId, providerFromSession, resolveProviderId, type ProviderId } from './providers.ts'

export interface SessionModelsRequest {
  rpcId?: string
  payload: { sessionId: string }
}

export interface SessionSelectModelRequest {
  rpcId?: string
  payload: {
    sessionId: string
    provider: string
    model: string
    reasoningEffort?: string
  }
}

export interface SessionModelGroup {
  id: string
  name: string
  models: Array<{ id: string; name: string; description?: string; reasoning?: unknown }>
}

export interface SessionModelsValue {
  current: HostModelSelection
  routable: boolean
  groups: SessionModelGroup[]
  failures: Array<{ id: string; name?: string; message?: string }>
}

export type UnaryOk<T> = { rpcId?: string; result: { ok: true; value: T } }
export type UnaryErr = {
  rpcId?: string
  result: { ok: false; error: { code: string; message: string; details?: unknown } }
}
export type UnaryResult<T> = UnaryOk<T> | UnaryErr

export interface AgentPresetSelectRequest {
  rpcId?: string
  payload: { sessionId: string; agentPreset: string }
}

export interface SessionPickerApiProxy {
  sessions: {
    models: (request: SessionModelsRequest) => Promise<UnaryResult<SessionModelsValue>>
    selectModel: (request: SessionSelectModelRequest) => Promise<UnaryResult<{ selected: HostModelSelection }>>
    [key: string]: unknown
  }
  agentPresets?: {
    select: (request: AgentPresetSelectRequest) => Promise<UnaryResult<{ agentPreset: string }>>
    [key: string]: unknown
  }
}

export interface PickerGateHost {
  agents?: { get?(id: string): unknown }
  sessions?: { get?(id: string): unknown }
}

interface SessionLike {
  header?: { agentPreset?: string }
  events?: ReadonlyArray<{ type: string; data: unknown }>
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function sessionOf(value: unknown): SessionLike | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  if (record.header !== undefined || record.events !== undefined) return record as SessionLike
  return undefined
}

export function providerOfPickerSession(
  host: PickerGateHost,
  sessionId: string,
): ProviderId | undefined {
  const agent = host.agents?.get?.(sessionId)
  const agentRecord = asRecord(agent)
  const fromAgent = sessionOf(agentRecord?.session) ?? sessionOf(agent)
  const fromStore = sessionOf(host.sessions?.get?.(sessionId))
  const session = fromAgent ?? fromStore
  const constructed = typeof agentRecord?.provider === 'string' ? agentRecord.provider : undefined
  return providerFromSession({
    preset: session?.header?.agentPreset,
    events: session?.events,
    provider: constructed,
  })
}

function modelUnavailable(
  request: SessionSelectModelRequest,
  agentProvider: string,
): UnaryErr {
  const label = isProviderId(agentProvider) ? PROVIDER_LABEL[agentProvider] : agentProvider
  const { provider, model } = request.payload
  const target = provider === agentProvider
    ? `model "${model}"`
    : `provider "${provider}" / model "${model}"`
  return {
    ...request.rpcId === undefined ? {} : { rpcId: request.rpcId },
    result: {
      ok: false,
      error: {
        code: 'model-unavailable',
        message: `${label} does not serve ${target}. Pick a ${label} model.`,
        details: { provider, model },
      },
    },
  }
}

function assignNamedMethods(target: object, methods: Record<string, unknown>): boolean {
  try {
    Object.assign(target, methods)
    return true
  } catch {
    return false
  }
}

export interface PickerGateDeps {
  providerOf(sessionId: string): ProviderId | undefined
  catalogOf(provider: string): ProjectedCatalog | undefined
  lastModels: LastModelsStore
}

function desiredSelection(deps: PickerGateDeps, provider: ProviderId): HostModelSelection {
  const catalog = deps.catalogOf(provider) ?? fallbackCatalog(provider)
  return selectionForAgent(catalog, deps.lastModels.recall(provider))
}

function selectPayload(
  sessionId: string,
  selection: HostModelSelection,
  rpcId?: string,
): SessionSelectModelRequest {
  return {
    ...rpcId === undefined ? {} : { rpcId },
    payload: {
      sessionId,
      provider: selection.provider,
      model: selection.model,
      ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
    },
  }
}

function replaceFace<T extends object>(
  owner: object,
  key: 'sessions' | 'agentPresets',
  current: T,
  next: T,
): () => void {
  const previous = current
  try {
    (owner as Record<string, unknown>)[key] = next
    return () => {
      try {
        (owner as Record<string, unknown>)[key] = previous
      } catch {
        void 0
      }
    }
  } catch {
    try {
      Object.defineProperty(owner, key, { configurable: true, value: next })
      return () => {
        try {
          Object.defineProperty(owner, key, { configurable: true, value: previous })
        } catch {
          void 0
        }
      }
    } catch {
      return () => {}
    }
  }
}

/**
 * Wrap host `session.models` / `session.selectModel` / `agentPreset.select`.
 * Returns a disposer that restores the previous methods.
 */
export function gateApiProxySessions(
  apiProxy: SessionPickerApiProxy,
  deps: PickerGateDeps,
): () => void {
  const sessions = apiProxy.sessions
  if (typeof sessions?.models !== 'function' || typeof sessions.selectModel !== 'function') {
    return () => {}
  }
  const originalModels = sessions.models.bind(sessions)
  const originalSelect = sessions.selectModel.bind(sessions)
  const presets = apiProxy.agentPresets
  const originalPresetSelect = typeof presets?.select === 'function'
    ? presets.select.bind(presets)
    : undefined

  const applyAgentModel = async (
    sessionId: string,
    provider: ProviderId,
    rpcId?: string,
  ): Promise<HostModelSelection> => {
    const desired = desiredSelection(deps, provider)
    const applied = await originalSelect(selectPayload(sessionId, desired, rpcId))
    const next = applied.result.ok ? applied.result.value.selected : desired
    deps.lastModels.remember(next)
    return next
  }

  const models: SessionPickerApiProxy['sessions']['models'] = async (request) => {
    const response = await originalModels(request)
    const provider = deps.providerOf(request.payload.sessionId)
    if (provider === undefined || !response.result.ok) return response
    const constrained = constrainSessionCatalog(response.result.value, provider)
    const catalog = deps.catalogOf(provider) ?? fallbackCatalog(provider)
    let current = response.result.value.current
    if (!selectionSupportedByAgent(provider, current, catalog)) {
      current = await applyAgentModel(request.payload.sessionId, provider, request.rpcId)
    }
    return {
      ...response,
      result: {
        ok: true,
        value: {
          ...response.result.value,
          current,
          groups: constrained.groups,
          failures: constrained.failures,
        },
      },
    }
  }

  const selectModel: SessionPickerApiProxy['sessions']['selectModel'] = async (request) => {
    const provider = deps.providerOf(request.payload.sessionId)
    if (provider !== undefined) {
      const catalog = deps.catalogOf(provider) ?? fallbackCatalog(provider)
      if (!selectionSupportedByAgent(provider, request.payload, catalog)) {
        return modelUnavailable(request, provider)
      }
    }
    const response = await originalSelect(request)
    if (response.result.ok) deps.lastModels.remember(response.result.value.selected)
    return response
  }

  const restores: Array<() => void> = []
  if (assignNamedMethods(sessions, { models, selectModel })) {
    restores.push(() => {
      assignNamedMethods(sessions, { models: originalModels, selectModel: originalSelect })
    })
  } else {
    restores.push(replaceFace(apiProxy, 'sessions', sessions, { ...sessions, models, selectModel }))
  }

  if (presets !== undefined && originalPresetSelect !== undefined) {
    const select: NonNullable<SessionPickerApiProxy['agentPresets']>['select'] = async (request) => {
      const response = await originalPresetSelect(request)
      if (!response.result.ok) return response
      const named = request.payload.agentPreset.trim().toLowerCase()
      const provider = PRESET_TO_PROVIDER[named] ?? (isProviderId(named) ? named : resolveProviderId({
        preset: request.payload.agentPreset,
        fallback: 'claude',
      }))
      await applyAgentModel(request.payload.sessionId, provider, request.rpcId)
      return response
    }
    if (assignNamedMethods(presets, { select })) {
      restores.push(() => { assignNamedMethods(presets, { select: originalPresetSelect }) })
    } else {
      restores.push(replaceFace(apiProxy, 'agentPresets', presets, { ...presets, select }))
    }
  }

  return () => {
    for (const restore of restores.reverse()) restore()
  }
}

interface PickerGateContext {
  inject?(deps: string[], callback: (host: PickerGateContext) => void): unknown
  apiProxy?: SessionPickerApiProxy
  agents?: PickerGateHost['agents']
  sessions?: PickerGateHost['sessions']
  get?(name: string): unknown
  effect?(fn: () => (() => unknown) | void, label?: string): unknown
}

export function installSessionPickerGate(
  ctx: PickerGateContext,
  catalog: AcpCatalogRegistry,
  lastModels: LastModelsStore,
): void {
  const attach = (host: PickerGateContext): void => {
    const apiProxy = host.apiProxy ?? host.get?.('apiProxy') as SessionPickerApiProxy | undefined
    if (apiProxy === undefined) return
    const lookup: PickerGateHost = {
      agents: host.agents ?? ctx.agents,
      sessions: host.sessions ?? ctx.sessions,
    }
    const deps: PickerGateDeps = {
      providerOf: (sessionId: string) => providerOfPickerSession(lookup, sessionId),
      catalogOf: (provider: string) => catalog.adapter.projected(provider),
      lastModels,
    }
    const run = (): (() => void) => gateApiProxySessions(apiProxy, deps)
    if (host.effect !== undefined) {
      host.effect(run, 'lumine-acp-session.session-picker-gate')
    } else {
      run()
    }
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['apiProxy'], attach)
    return
  }
  attach(ctx)
}
