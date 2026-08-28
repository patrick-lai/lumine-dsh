import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AcpChild } from '../src/client.ts'
import { TurnProjector } from '../src/events.ts'
import {
  AcpCatalogAdapter,
  AcpCatalogRegistry,
  fallbackCatalog,
  lastModelSelection,
  pickerSnapshot,
  projectAcpModels,
} from '../src/models.ts'

const fakeChild = fileURLToPath(new URL('./fixtures/fake-acp-child.mjs', import.meta.url))

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
    currentValue: 'grok-4.5',
    options: [
      { value: 'grok-4.5', name: 'Grok 4.5' },
      { value: 'grok-4', name: 'Grok 4' },
    ],
  },
]

describe('ACP config-option → session.models projection', () => {
  it('reads v1 model options and ignores DeepSeek', () => {
    const catalog = projectAcpModels('grok', { configOptions: grokOptions })
    expect(catalog.provider).toBe('grok')
    expect(catalog.currentModel).toBe('grok-4.5')
    expect(catalog.models.map(model => model.id)).toEqual(['grok-4.5', 'grok-4'])

    const adapter = new AcpCatalogAdapter()
    adapter.replace(catalog)
    const picker = pickerSnapshot(adapter, { provider: 'grok', model: catalog.currentModel })
    expect(picker.routable).toBe(true)
    expect(picker.current).toEqual({ provider: 'grok', model: 'grok-4.5' })
    expect(picker.groups.map(group => group.id)).toEqual(['grok'])
    expect(picker.groups[0]?.models.map(model => model.id)).toEqual(['grok-4.5', 'grok-4'])
    expect(JSON.stringify(picker)).not.toMatch(/deepseek/i)
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
    expect(projectAcpModels('grok', {})).toEqual(fallbackCatalog('grok'))
  })

  it('reads legacy session/new models when configOptions is empty', () => {
    const catalog = projectAcpModels('claude', {
      models: { currentModelId: 'sonnet', availableModels: [{ modelId: 'sonnet', name: 'Sonnet' }, { modelId: 'opus', name: 'Opus' }] },
    })
    expect(catalog.currentModel).toBe('sonnet')
    expect(catalog.models.map(model => model.id)).toEqual(['sonnet', 'opus'])
  })

  it('projects thought_level onto resolveModel reasoning', async () => {
    const catalog = projectAcpModels('grok', {
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
    const resolved = await adapter.resolveModel('grok', 'grok-4.5')
    expect(resolved.reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'high'])
    expect(resolved.reasoning?.defaultEffort).toBe('high')
  })

  it('throws if the host tries to generate through the catalog adapter', async () => {
    const adapter = new AcpCatalogAdapter()
    await expect(async () => {
      for await (const _chunk of adapter.stream()) void _chunk
    }).rejects.toThrow(/does not generate/)
  })

  it('registers only the ACP product on the host llm catalog', () => {
    const registered: string[][] = []
    const llm = {
      registerAdapter(providers: string[]) {
        registered.push([...providers])
        const handle = (() => {}) as { (): void; replace(next: string[]): void }
        handle.replace = (next: string[]) => { registered.push([...next]) }
        return handle
      },
    }
    const registry = new AcpCatalogRegistry(llm)
    registry.publish(projectAcpModels('grok', { configOptions: grokOptions }))
    expect(registered).toEqual([['grok']])
    expect(registry.adapter.advertisedProviders()).toEqual(['grok'])
  })

  it('reads the latest model/selection from the session log', () => {
    expect(lastModelSelection([
      { type: 'model/selection', data: { provider: 'grok', model: 'grok-4.5' } },
      { type: 'model/selection', data: { provider: 'grok', model: 'grok-3', reasoningEffort: 'low' } },
    ])).toEqual({ provider: 'grok', model: 'grok-3', reasoningEffort: 'low' })
  })
})

describe('fake ACP child model catalog + pong', () => {
  it('projects advertised models, maps selectModel onto set_config_option, and lands pong in the log', async () => {
    const child = new AcpChild({
      launch: launch(),
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
      const catalog = child.projectCatalog('grok')
      expect(catalog.models.map(model => model.id)).toEqual(['grok-4.5', 'grok-4', 'grok-3'])
      expect(catalog.currentModel).toBe('grok-4.5')

      const adapter = new AcpCatalogAdapter()
      adapter.replace(catalog)
      session.append('model/selection', { provider: 'grok', model: catalog.currentModel, reasoningEffort: 'high' })
      const picker = pickerSnapshot(adapter, lastModelSelection(session.events)!)
      expect(picker.current.provider).toBe('grok')
      expect(picker.current.model).toBe('grok-4.5')
      expect(picker.groups.some(group => group.id === 'deepseek-official')).toBe(false)
      expect(picker.routable).toBe(true)

      await child.applyHostSelection('grok', { model: 'grok-3', reasoningEffort: 'low' })
      const after = child.projectCatalog('grok')
      expect(after.currentModel).toBe('grok-3')
      expect(after.reasoning?.current).toBe('low')
      session.append('model/selection', { provider: 'grok', model: 'grok-3', reasoningEffort: 'low' })

      const projector = new TurnProjector(1, 1, { provider: 'grok', model: 'grok-3' })
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
      const assistant = log.find(op => op.type === 'assistant/message')?.data as {
        message: { content: Array<{ type: string; text?: string }> }
      }
      expect(assistant.message.content.some(block => block.type === 'text' && block.text === 'pong')).toBe(true)
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
      await child.setConfigOption('model', 'grok-4')
      expect(child.projectCatalog('grok').currentModel).toBe('grok-4')
    } finally {
      await child.dispose()
    }
  })
})
