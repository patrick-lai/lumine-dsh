import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LastModelsStore } from '../src/last-models.ts'
import {
  AcpCatalogRegistry,
  constrainSessionCatalog,
  hostSessionModels,
  pickerSnapshot,
  selectionForAgent,
  selectionSupportedByAgent,
} from '../src/models.ts'
import {
  gateApiProxySessions,
  installSessionPickerGate,
  providerOfPickerSession,
  type SessionModelsValue,
  type SessionPickerApiProxy,
  type UnaryResult,
} from '../src/picker-gate.ts'
import { lastSelectedAgentPreset, providerFromSession } from '../src/providers.ts'
import { createHostLikeLlm } from './host-llm.ts'

function tmpStore(): LastModelsStore {
  return new LastModelsStore(join(mkdtempSync(join(tmpdir(), 'lumine-last-')), 'last-models.json'))
}

const HOST_GROUPS: SessionModelsValue['groups'] = [
  { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }] },
  { id: 'claude', name: 'Claude Code', models: [{ id: 'default', name: 'Default (recommended)' }, { id: 'sonnet', name: 'Sonnet' }] },
  { id: 'codex', name: 'Codex', models: [{ id: 'codex', name: 'Codex' }] },
  { id: 'cursor', name: 'Cursor', models: [{ id: 'composer-2', name: 'Composer 2' }] },
  { id: 'grok', name: 'Grok Build', models: [{ id: 'grok-4.6', name: 'Grok 4.6' }, { id: 'grok-4.5', name: 'Grok 4.5' }] },
]

function modelsResponse(groups = HOST_GROUPS): UnaryResult<SessionModelsValue> {
  return {
    rpcId: 'rpc-1',
    result: {
      ok: true,
      value: {
        current: { provider: 'claude', model: 'default' },
        routable: true,
        groups,
        failures: [{ id: 'openai', name: 'OpenAI', message: 'timeout' }],
      },
    },
  }
}

describe('composer picker lists only the selected ACP agent', () => {
  it('drops DeepSeek and the other ACP products from the session catalog', () => {
    const constrained = constrainSessionCatalog({
      groups: HOST_GROUPS,
      failures: [{ id: 'openai', message: 'timeout' }, { id: 'claude', message: 'stale' }],
    }, 'claude')
    expect(constrained.groups.map(group => group.id)).toEqual(['claude'])
    expect(constrained.groups[0]?.models.map(model => model.id)).toEqual(['default', 'sonnet'])
    expect(constrained.failures.map(failure => failure.id)).toEqual(['claude'])
    expect(JSON.stringify(constrained)).not.toMatch(/deepseek|grok-4|codex|cursor|openai/i)
  })

  it('rejects a model the selected agent does not serve', () => {
    const claude = { models: [{ id: 'default' }, { id: 'sonnet' }] }
    expect(selectionSupportedByAgent('claude', { provider: 'claude', model: 'sonnet' }, claude)).toBe(true)
    expect(selectionSupportedByAgent('claude', { provider: 'grok', model: 'grok-4.6' }, claude)).toBe(false)
    expect(selectionSupportedByAgent('claude', { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, claude)).toBe(false)
    expect(selectionSupportedByAgent('claude', { provider: 'claude', model: 'opus-not-advertised' }, claude)).toBe(false)
  })

  it('resolves the live preset, including a blank-session switch', () => {
    expect(lastSelectedAgentPreset([
      { type: 'agent-preset/selected', data: { agentPreset: 'claude-code' } },
      { type: 'agent-preset/selected', data: { agentPreset: 'grok-build' } },
    ])).toBe('grok-build')
    expect(providerFromSession({ preset: 'claude-code' })).toBe('claude')
    expect(providerFromSession({
      preset: 'claude-code',
      events: [{ type: 'agent-preset/selected', data: { agentPreset: 'cursor' } }],
    })).toBe('cursor')
    expect(providerFromSession({ provider: 'grok' })).toBe('grok')
    expect(providerFromSession({ provider: 'deepseek-official' })).toBeUndefined()
    expect(providerFromSession({})).toBeUndefined()
  })

  it('reads the agent from the session registry', () => {
    const host = {
      agents: {
        get(id: string) {
          if (id !== 's1') return undefined
          return {
            provider: 'claude',
            session: {
              header: { agentPreset: 'claude-code' },
              events: [],
            },
          }
        },
      },
    }
    expect(providerOfPickerSession(host, 's1')).toBe('claude')
    expect(providerOfPickerSession({
      sessions: {
        get: () => ({
          header: { agentPreset: 'grok-build' },
          events: [{ type: 'agent-preset/selected', data: { agentPreset: 'codex' } }],
        }),
      },
    }, 's2')).toBe('codex')
  })
})

describe('apiProxy session.models / selectModel gate', () => {
  it('filters session.models and refuses a foreign selectModel', async () => {
    const llm = createHostLikeLlm()
    const catalog = new AcpCatalogRegistry(llm)
    catalog.seedDefaults()
    const calls: string[] = []
    const apiProxy: SessionPickerApiProxy = {
      sessions: {
        async models(request) {
          calls.push(`models:${request.payload.sessionId}`)
          return modelsResponse()
        },
        async selectModel(request) {
          calls.push(`select:${request.payload.provider}/${request.payload.model}`)
          return {
            rpcId: request.rpcId,
            result: { ok: true, value: { selected: { provider: request.payload.provider, model: request.payload.model } } },
          }
        },
      },
    }

    const restore = gateApiProxySessions(apiProxy, {
      providerOf: (sessionId) => sessionId === 'claude-session' ? 'claude' : undefined,
      catalogOf: (provider) => catalog.adapter.projected(provider),
      lastModels: tmpStore(),
    })

    const listed = await apiProxy.sessions.models({ rpcId: 'rpc-1', payload: { sessionId: 'claude-session' } })
    expect(listed.result.ok).toBe(true)
    if (listed.result.ok) {
      expect(listed.result.value.groups.map(group => group.id)).toEqual(['claude'])
      expect(listed.result.value.groups[0]?.models.map(model => model.id)).toEqual(['default', 'sonnet'])
      expect(listed.result.value.failures).toEqual([])
      expect(JSON.stringify(listed)).not.toMatch(/deepseek|grok-4|composer-2/i)
    }

    const sameAgent = await apiProxy.sessions.selectModel({
      rpcId: 'rpc-2',
      payload: { sessionId: 'claude-session', provider: 'claude', model: 'sonnet' },
    })
    expect(sameAgent.result).toEqual({ ok: true, value: { selected: { provider: 'claude', model: 'sonnet' } } })

    const foreign = await apiProxy.sessions.selectModel({
      rpcId: 'rpc-3',
      payload: { sessionId: 'claude-session', provider: 'grok', model: 'grok-4.6' },
    })
    expect(foreign.result.ok).toBe(false)
    if (!foreign.result.ok) {
      expect(foreign.result.error.code).toBe('model-unavailable')
      expect(foreign.result.error.message).toMatch(/Claude Code does not serve provider "grok"/)
      expect(foreign.result.error.details).toEqual({ provider: 'grok', model: 'grok-4.6' })
    }
    expect(calls).toEqual(['models:claude-session', 'select:claude/sonnet'])

    const unscoped = await apiProxy.sessions.models({ payload: { sessionId: 'unknown' } })
    expect(unscoped.result.ok && unscoped.result.value.groups.map(group => group.id)).toEqual([
      'deepseek-official', 'claude', 'codex', 'cursor', 'grok',
    ])

    restore()
    const after = await apiProxy.sessions.models({ payload: { sessionId: 'claude-session' } })
    expect(after.result.ok && after.result.value.groups.map(group => group.id)).toEqual([
      'deepseek-official', 'claude', 'codex', 'cursor', 'grok',
    ])
  })

  it('wires the gate from apply via ctx.inject(apiProxy)', async () => {
    const llm = createHostLikeLlm()
    const catalog = new AcpCatalogRegistry(llm)
    catalog.seedDefaults()
    const apiProxy: SessionPickerApiProxy = {
      sessions: {
        async models() { return modelsResponse() },
        async selectModel(request) {
          return {
            result: { ok: true, value: { selected: { provider: request.payload.provider, model: request.payload.model } } },
          }
        },
      },
    }
    const injected: string[] = []
    const host = {
      agents: {
        get: () => ({
          provider: 'claude',
          session: { header: { agentPreset: 'claude-code' }, events: [] },
        }),
      },
      inject(deps: string[], callback: (value: {
        apiProxy: SessionPickerApiProxy
        agents?: { get: () => unknown }
        sessions?: undefined
      }) => void) {
        injected.push(...deps)
        callback({ apiProxy, agents: host.agents, sessions: undefined })
      },
    }
    installSessionPickerGate(host, catalog, tmpStore())

    expect(injected).toEqual(['apiProxy'])
    const listed = await apiProxy.sessions.models({ payload: { sessionId: 's1' } })
    expect(listed.result.ok && listed.result.value.groups.map(group => group.id)).toEqual(['claude'])
  })
})

describe('pickerSnapshot after seeding every ACP product', () => {
  it('shows only Grok when the session current is Grok', async () => {
    const llm = createHostLikeLlm()
    const registry = new AcpCatalogRegistry(llm)
    registry.seedDefaults()
    const picker = pickerSnapshot(registry.adapter, { provider: 'grok', model: 'grok-4.6', reasoningEffort: 'high' })
    expect(picker.groups.map(group => group.id)).toEqual(['grok'])
    expect(picker.groups[0]?.models.map(model => model.id)).toEqual(['grok-4.6', 'grok-4.5'])
    const host = await hostSessionModels(llm, { provider: 'grok', model: 'grok-4.6' })
    expect(host.groups.map(group => group.id)).toEqual(['claude', 'codex', 'cursor', 'grok'])
    const constrained = constrainSessionCatalog(host, 'grok')
    expect(constrained.groups.map(group => group.id)).toEqual(['grok'])
  })

  it('shows only Claude Code when the session current is Claude', () => {
    const llm = createHostLikeLlm()
    const registry = new AcpCatalogRegistry(llm)
    registry.seedDefaults()
    const picker = pickerSnapshot(registry.adapter, { provider: 'claude', model: 'default' })
    expect(picker.groups.map(group => group.id)).toEqual(['claude'])
    expect(picker.groups[0]?.models.map(model => model.id)).toEqual([
      'default',
      'opus[1m]',
      'claude-fable-5[1m]',
      'sonnet',
      'haiku',
    ])
    expect(JSON.stringify(picker)).not.toMatch(/deepseek|grok-4|composer-2/i)
  })
})

describe('last-used model per ACP agent', () => {
  it('keeps last-used when still advertised, else the catalog default', () => {
    const llm = createHostLikeLlm()
    const registry = new AcpCatalogRegistry(llm)
    registry.seedDefaults()
    const claude = registry.adapter.projected('claude')!
    const grok = registry.adapter.projected('grok')!
    expect(selectionForAgent(claude, { model: 'sonnet', reasoningEffort: 'high' })).toMatchObject({
      provider: 'claude',
      model: 'sonnet',
      reasoningEffort: 'high',
    })
    expect(selectionForAgent(claude, { model: 'not-a-claude-model' })).toMatchObject({
      provider: 'claude',
      model: 'default',
    })
    expect(selectionForAgent(grok)).toMatchObject({ provider: 'grok', model: 'grok-4.6', reasoningEffort: 'high' })
  })

  it('on agent swap applies remembered model, then restores it on swap back', async () => {
    const llm = createHostLikeLlm()
    const catalog = new AcpCatalogRegistry(llm)
    catalog.seedDefaults()
    const lastModels = tmpStore()
    let preset = 'claude-code'
    let current = { provider: 'claude', model: 'default' }
    const apiProxy: SessionPickerApiProxy = {
      sessions: {
        async models() {
          return {
            result: {
              ok: true,
              value: { current, routable: true, groups: HOST_GROUPS, failures: [] },
            },
          }
        },
        async selectModel(request) {
          current = {
            provider: request.payload.provider,
            model: request.payload.model,
            ...request.payload.reasoningEffort === undefined ? {} : { reasoningEffort: request.payload.reasoningEffort },
          }
          return { result: { ok: true, value: { selected: current } } }
        },
      },
      agentPresets: {
        async select(request) {
          preset = request.payload.agentPreset
          return { result: { ok: true, value: { agentPreset: preset } } }
        },
      },
    }
    gateApiProxySessions(apiProxy, {
      providerOf: () => providerFromSession({ preset }) ?? 'claude',
      catalogOf: (provider) => catalog.adapter.projected(provider),
      lastModels,
    })

    await apiProxy.sessions.selectModel({
      payload: { sessionId: 's1', provider: 'claude', model: 'sonnet', reasoningEffort: 'high' },
    })
    expect(lastModels.recall('claude')).toEqual({ model: 'sonnet', reasoningEffort: 'high' })

    await apiProxy.agentPresets!.select({ payload: { sessionId: 's1', agentPreset: 'grok-build' } })
    expect(current).toMatchObject({ provider: 'grok', model: 'grok-4.6' })
    expect(lastModels.recall('grok')?.model).toBe('grok-4.6')

    await apiProxy.sessions.selectModel({
      payload: { sessionId: 's1', provider: 'grok', model: 'grok-4.5', reasoningEffort: 'medium' },
    })
    await apiProxy.agentPresets!.select({ payload: { sessionId: 's1', agentPreset: 'claude-code' } })
    expect(current).toMatchObject({ provider: 'claude', model: 'sonnet', reasoningEffort: 'high' })

    const listed = await apiProxy.sessions.models({ payload: { sessionId: 's1' } })
    expect(listed.result.ok && listed.result.value.current).toMatchObject({
      provider: 'claude',
      model: 'sonnet',
    })
    expect(listed.result.ok && listed.result.value.groups.map(group => group.id)).toEqual(['claude'])
  })

  it('session.models repairs a leftover current from the previous agent', async () => {
    const llm = createHostLikeLlm()
    const catalog = new AcpCatalogRegistry(llm)
    catalog.seedDefaults()
    const lastModels = tmpStore()
    lastModels.remember({ provider: 'grok', model: 'grok-4.5', reasoningEffort: 'low' })
    let current = { provider: 'claude', model: 'sonnet' }
    const apiProxy: SessionPickerApiProxy = {
      sessions: {
        async models() {
          return {
            result: {
              ok: true,
              value: { current, routable: true, groups: HOST_GROUPS, failures: [] },
            },
          }
        },
        async selectModel(request) {
          current = { provider: request.payload.provider, model: request.payload.model, reasoningEffort: request.payload.reasoningEffort }
          return { result: { ok: true, value: { selected: current } } }
        },
      },
    }
    gateApiProxySessions(apiProxy, {
      providerOf: () => 'grok',
      catalogOf: (provider) => catalog.adapter.projected(provider),
      lastModels,
    })
    const listed = await apiProxy.sessions.models({ payload: { sessionId: 's1' } })
    expect(listed.result.ok && listed.result.value.current).toMatchObject({
      provider: 'grok',
      model: 'grok-4.5',
      reasoningEffort: 'low',
    })
    expect(current.provider).toBe('grok')
    expect(current.model).toBe('grok-4.5')
  })
})

