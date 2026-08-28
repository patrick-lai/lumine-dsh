import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AcpChild } from '../src/client.ts'
import { TurnProjector } from '../src/events.ts'
import {
  AcpCatalogAdapter,
  AcpCatalogRegistry,
  configIdForModel,
  configIdForReasoning,
  fallbackCatalog,
  lastModelSelection,
  pickerSnapshot,
  projectAcpModels,
} from '../src/models.ts'
import { createHostLikeLlm } from './host-llm.ts'

const fakeChild = fileURLToPath(new URL('./fixtures/fake-acp-child.mjs', import.meta.url))
const gold = JSON.parse(readFileSync(new URL('./fixtures/grok-1.0.5-handshake.json', import.meta.url), 'utf8')) as {
  initialize: unknown
  sessionNew: unknown
}

function dummyAgent() {
  return {
    id: 'sess-1',
    session: { header: { cwd: process.cwd() }, events: [], append() { return { seq: 0 } } },
  } as never
}

function launch(env: NodeJS.ProcessEnv = {}) {
  return {
    provider: 'grok' as const,
    command: process.execPath,
    args: [fakeChild],
    env,
    unset: [],
    productCommand: 'grok',
  }
}

const grokOptions = [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: 'composer-2',
    options: [
      { value: 'composer-2', name: 'Composer 2' },
      { value: 'gpt-5', name: 'GPT-5' },
    ],
  },
]

describe('ACP config-option → session.models projection', () => {
  it('projects the live Grok 1.0.5 handshake, not DeepSeek and not an invented catalog', () => {
    const catalog = projectAcpModels('grok', [gold.initialize, gold.sessionNew])
    expect(catalog.models.map(model => ({ id: model.id, name: model.name }))).toEqual([
      { id: 'grok-4.6', name: 'Grok 4.6' },
      { id: 'grok-4.5', name: 'Grok 4.5' },
    ])
    expect(catalog.currentModel).toBe('grok-4.6')
    expect(catalog.modelSetStyle).toBe('option-id')
    expect(configIdForModel(catalog, 'grok-4.5')).toBe('grok-4.5')
    expect(catalog.reasoning?.efforts.map(effort => effort.id)).toEqual(['xhigh', 'high', 'medium', 'low'])
    expect(catalog.reasoning?.current).toBe('high')
    expect(catalog.reasoning?.setStyle).toBe('option-id')
    expect(configIdForReasoning(catalog, 'medium')).toBe('medium')

    const adapter = new AcpCatalogAdapter()
    adapter.replace(catalog)
    const picker = pickerSnapshot(adapter, {
      provider: 'grok',
      model: catalog.currentModel,
      reasoningEffort: catalog.reasoning?.current,
    })
    expect(picker.current.provider).toBe('grok')
    expect(picker.current.provider).not.toBe('deepseek-official')
    expect(picker.current.model).toBe('grok-4.6')
    expect(picker.routable).toBe(true)
    expect(picker.groups.map(group => group.id)).toEqual(['grok'])
    expect(picker.groups[0]?.models.map(model => model.id)).toEqual(['grok-4.6', 'grok-4.5'])
    expect(JSON.stringify(picker)).not.toMatch(/deepseek/i)
    expect(JSON.stringify(picker)).not.toMatch(/grok-4[^.]|grok-3/)
  })

  it('reads initialize.modelState when session/new models are missing', () => {
    const catalog = projectAcpModels('grok', gold.initialize)
    expect(catalog.currentModel).toBe('grok-4.6')
    expect(catalog.models.map(model => model.id)).toEqual(['grok-4.6', 'grok-4.5'])
  })

  it('reads standard v1 select options for Cursor/Claude/Codex', () => {
    const catalog = projectAcpModels('cursor', { configOptions: grokOptions })
    expect(catalog.provider).toBe('cursor')
    expect(catalog.currentModel).toBe('composer-2')
    expect(catalog.modelSetStyle).toBe('select')
    expect(configIdForModel(catalog, 'gpt-5')).toBe('model')
    expect(catalog.models.map(model => model.id)).toEqual(['composer-2', 'gpt-5'])
  })

  it('flattens grouped options and v2 configId', () => {
    const catalog = projectAcpModels('cursor', {
      configOptions: [{
        configId: 'model',
        category: 'model',
        type: 'select',
        currentValue: 'composer-2',
        options: [{
          group: 'cursor',
          name: 'Cursor',
          options: [
            { value: 'composer-2', name: 'Composer 2' },
            { value: 'gpt-5', name: 'GPT-5' },
          ],
        }],
      }],
    })
    expect(catalog.modelConfigId).toBe('model')
    expect(catalog.models.map(model => model.id)).toEqual(['composer-2', 'gpt-5'])
    expect(catalog.currentModel).toBe('composer-2')
  })

  it('falls back when the agent advertises no models', () => {
    const catalog = projectAcpModels('grok', {})
    expect(catalog).toEqual(fallbackCatalog('grok'))
    expect(catalog.models.map(model => model.id)).toEqual(['grok-4.6', 'grok-4.5'])
    expect(catalog.currentModel).toBe('grok-4.6')
  })

  it('seeds Claude Code from the live ACP 0.70 catalog, not Grok or DeepSeek', () => {
    expect(fallbackCatalog('claude').models.map(model => model.id)).toEqual([
      'default',
      'opus[1m]',
      'claude-fable-5[1m]',
      'sonnet',
      'haiku',
    ])
    expect(fallbackCatalog('claude').currentModel).toBe('default')
    expect(JSON.stringify(fallbackCatalog('claude'))).not.toMatch(/grok-4|deepseek/i)
  })

  it('reads legacy session/new models when configOptions is empty', () => {
    const catalog = projectAcpModels('claude', {
      models: { currentModelId: 'sonnet', availableModels: [{ modelId: 'sonnet', name: 'Sonnet' }, { modelId: 'opus', name: 'Opus' }] },
    })
    expect(catalog.currentModel).toBe('sonnet')
    expect(catalog.models.map(model => model.id)).toEqual(['sonnet', 'opus'])
  })

  it('projects thought_level onto resolveModel reasoning', async () => {
    const catalog = projectAcpModels('cursor', {
      configOptions: [
        ...grokOptions,
        {
          id: 'reasoning_effort',
          category: 'thought_level',
          type: 'select',
          currentValue: 'high',
          options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }],
        },
      ],
    })
    const adapter = new AcpCatalogAdapter()
    adapter.replace(catalog)
    const resolved = await adapter.resolveModel('cursor', 'composer-2')
    expect(resolved.reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'high'])
    expect(resolved.reasoning?.defaultEffort).toBe('high')
  })

  it('uses per-model reasoningEfforts from Grok 4.6 vs 4.5', async () => {
    const catalog = projectAcpModels('grok', gold.sessionNew)
    const adapter = new AcpCatalogAdapter()
    adapter.replace(catalog)
    expect((await adapter.resolveModel('grok', 'grok-4.6')).reasoning?.efforts.map(effort => effort.id))
      .toEqual(['xhigh', 'high', 'medium', 'low'])
    expect((await adapter.resolveModel('grok', 'grok-4.5')).reasoning?.efforts.map(effort => effort.id))
      .toEqual(['high', 'medium', 'low'])
  })

  it('throws if the host tries to generate through the catalog adapter', async () => {
    const adapter = new AcpCatalogAdapter()
    await expect(async () => {
      for await (const _chunk of adapter.stream()) void _chunk
    }).rejects.toThrow(/does not generate/)
  })

  it('registers only the ACP product on the host llm catalog', () => {
    const llm = createHostLikeLlm()
    const registry = new AcpCatalogRegistry(llm)
    registry.publish(projectAcpModels('grok', gold.sessionNew))
    expect(llm.listProviders().map(entry => entry.id)).toEqual(['grok'])
    expect(registry.adapter.advertisedProviders()).toEqual(['grok'])
  })

  it('reads the latest model/selection from the session log', () => {
    expect(lastModelSelection([
      { type: 'model/selection', data: { provider: 'grok', model: 'grok-4.6' } },
      { type: 'model/selection', data: { provider: 'grok', model: 'grok-4.5', reasoningEffort: 'low' } },
    ])).toEqual({ provider: 'grok', model: 'grok-4.5', reasoningEffort: 'low' })
  })
})

describe('fake ACP child (Grok 1.0.5 gold) + pong', () => {
  it('does not authenticate, projects Grok 4.6/4.5, maps selectModel onto option ids, and lands pong', async () => {
    const child = new AcpChild({
      launch: launch({ FAKE_ACP_FORBID_AUTH: '1' }),
      cwd: process.cwd(),
      permission: 'yolo',
      agent: dummyAgent(),
    })
    const session = {
      events: [] as Array<{ type: string; data: unknown }>,
      append(type: string, data: unknown) {
        this.events.push({ type, data })
      },
    }

    try {
      await child.ensure()
      expect(child.calledAuthenticate).toBe(false)
      const catalog = child.projectCatalog('grok')
      expect(catalog.models.map(model => model.id)).toEqual(['grok-4.6', 'grok-4.5'])
      expect(catalog.currentModel).toBe('grok-4.6')
      expect(catalog.reasoning?.current).toBe('high')

      const adapter = new AcpCatalogAdapter()
      adapter.replace(catalog)
      session.append('model/selection', {
        provider: 'grok',
        model: catalog.currentModel,
        reasoningEffort: 'high',
      })
      const picker = pickerSnapshot(adapter, lastModelSelection(session.events)!)
      expect(picker.current).toEqual({ provider: 'grok', model: 'grok-4.6', reasoningEffort: 'high' })
      expect(picker.current.provider).not.toBe('deepseek-official')
      expect(picker.groups.some(group => group.id === 'deepseek-official')).toBe(false)
      expect(picker.routable).toBe(true)

      await child.applyHostSelection('grok', { model: 'grok-4.5', reasoningEffort: 'medium' })
      const after = child.projectCatalog('grok')
      expect(after.currentModel).toBe('grok-4.5')
      expect(after.reasoning?.current).toBe('medium')
      session.append('model/selection', { provider: 'grok', model: 'grok-4.5', reasoningEffort: 'medium' })

      const projector = new TurnProjector(1, 1, { provider: 'grok', model: 'grok-4.5' })
      const log = [
        ...projector.startTurn({
          id: 'u1',
          role: 'user',
          content: [{ type: 'text', text: 'Reply with the single word pong' }],
          source: { kind: 'user' },
        }),
        ...projector.syntheticHeader('initial'),
      ]
      child.onUpdate = update => {
        log.push(...projector.onUpdate(update))
      }
      const result = await child.prompt([{ type: 'text', text: 'Reply with the single word pong' }])
      expect(result.stopReason).toBe('end_turn')
      log.push(...projector.finish('completed'))

      expect(log.map(op => op.type)).toEqual(expect.arrayContaining([
        'turn/start',
        'user/message',
        'assistant/chunk',
        'assistant/message',
        'turn/end',
      ]))
      const text = log
        .filter(op => op.type === 'assistant/chunk')
        .map(op => (op.data as { chunk: { type: string; text?: string } }).chunk)
        .filter(chunk => chunk.type === 'text-delta')
        .map(chunk => chunk.text)
        .join('')
      expect(text).toBe('pong')
    } finally {
      await child.dispose()
    }
  })

  it('falls back to session/set_model when set_config_option is missing', async () => {
    const child = new AcpChild({
      launch: launch({ FAKE_ACP_NO_SET_CONFIG: '1' }),
      cwd: process.cwd(),
      permission: 'yolo',
      agent: dummyAgent(),
    })
    try {
      await child.ensure()
      await child.setConfigOption('grok-4.5', 'grok-4.5')
      expect(child.projectCatalog('grok').currentModel).toBe('grok-4.5')
    } finally {
      await child.dispose()
    }
  })
})
