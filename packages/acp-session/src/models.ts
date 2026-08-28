import { PROVIDER_IDS, PROVIDER_LABEL, type ProviderId } from './providers.ts'

/** One selectable model projected from an ACP config option. */
export interface CatalogModel {
  id: string
  name: string
  description?: string
}

export interface CatalogReasoning {
  configId: string
  efforts: Array<{ id: string; name: string; description?: string }>
  current?: string
  defaultEffort?: string
}

/**
 * Session model catalog the DSH web picker already reads, sourced from ACP
 * config options (or a per-product fallback when the child advertises none).
 */
export interface ProjectedCatalog {
  provider: ProviderId
  providerName: string
  models: CatalogModel[]
  currentModel: string
  modelConfigId: string
  reasoning?: CatalogReasoning
}

export interface HostModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface AdapterRegistrationHandle {
  (): void
  replace(providers: string[]): void
}

export interface LlmRegistry {
  registerAdapter(providers: string[], adapter: AcpCatalogAdapter): AdapterRegistrationHandle
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** ACP v1 uses `id`; v2 uses `configId`. */
export function configOptionId(option: unknown): string {
  const record = asRecord(option)
  if (!record) return ''
  if (typeof record.id === 'string' && record.id) return record.id
  if (typeof record.configId === 'string' && record.configId) return record.configId
  return ''
}

export function isModelConfigOption(option: unknown): boolean {
  const record = asRecord(option)
  if (!record) return false
  const id = configOptionId(record)
  return record.category === 'model' || id === 'model'
}

export function isThoughtConfigOption(option: unknown): boolean {
  const record = asRecord(option)
  if (!record) return false
  const id = configOptionId(record)
  return record.category === 'thought_level'
    || id === 'reasoning_effort'
    || id === 'thought_level'
}

function choiceFrom(item: unknown): CatalogModel | undefined {
  const record = asRecord(item)
  if (!record) return undefined
  const id = typeof record.value === 'string' && record.value
    ? record.value
    : typeof record.id === 'string' && record.id
      ? record.id
      : typeof record.modelId === 'string' && record.modelId
        ? record.modelId
        : ''
  if (!id) return undefined
  const name = typeof record.name === 'string' && record.name ? record.name : id
  const description = typeof record.description === 'string' && record.description
    ? record.description
    : undefined
  return description === undefined ? { id, name } : { id, name, description }
}

function looksGrouped(item: Record<string, unknown>): boolean {
  if (!Array.isArray(item.options) || item.options.length === 0) return false
  if (typeof item.value === 'string' && item.value) return false
  return item.options.some(entry => choiceFrom(entry) !== undefined || asRecord(entry)?.options !== undefined)
}

/** Flatten a select option's `options` array, including `{ group, options }` rows. */
export function flattenSelectChoices(options: unknown): CatalogModel[] {
  if (!Array.isArray(options)) return []
  const out: CatalogModel[] = []
  const seen = new Set<string>()
  const walk = (items: unknown[]): void => {
    for (const item of items) {
      const record = asRecord(item)
      if (!record) continue
      if (looksGrouped(record)) {
        walk(record.options as unknown[])
        continue
      }
      const choice = choiceFrom(record)
      if (!choice || seen.has(choice.id)) continue
      seen.add(choice.id)
      out.push(choice)
    }
  }
  walk(options)
  return out
}

export function collectConfigOptions(payload: unknown): unknown[] {
  const record = asRecord(payload)
  if (!record) return []
  if (Array.isArray(record.configOptions)) return record.configOptions
  if (Array.isArray(payload)) return payload
  return []
}

/** Older agents advertised `models` / `availableModels` on session/new. */
export function legacyModels(payload: unknown): { models: CatalogModel[]; current?: string } | undefined {
  const record = asRecord(payload)
  if (!record) return undefined
  const modelsField = asRecord(record.models)
  const list = Array.isArray(record.models)
    ? record.models
    : Array.isArray(modelsField?.availableModels)
      ? modelsField?.availableModels
      : Array.isArray(record.availableModels)
        ? record.availableModels
        : undefined
  if (!Array.isArray(list) || list.length === 0) return undefined
  const models = flattenSelectChoices(list.map((item) => {
    const row = asRecord(item) ?? {}
    return {
      value: row.value ?? row.id ?? row.modelId,
      name: row.name,
      description: row.description,
    }
  }))
  const current = typeof record.currentModelId === 'string' && record.currentModelId
    ? record.currentModelId
    : typeof modelsField?.currentModelId === 'string' && modelsField.currentModelId
      ? modelsField.currentModelId
      : undefined
  return models.length > 0 ? { models, current } : undefined
}

export function fallbackCatalog(provider: ProviderId): ProjectedCatalog {
  return {
    provider,
    providerName: PROVIDER_LABEL[provider],
    models: [{ id: provider, name: PROVIDER_LABEL[provider] }],
    currentModel: provider,
    modelConfigId: 'model',
  }
}

export function projectAcpModels(
  provider: ProviderId,
  payload: unknown,
): ProjectedCatalog {
  const options = collectConfigOptions(payload)
  const modelOption = options.find(isModelConfigOption)
  const thoughtOption = options.find(isThoughtConfigOption)
  const fromOption = modelOption ? flattenSelectChoices(asRecord(modelOption)?.options) : []
  const fromLegacy = fromOption.length === 0 ? legacyModels(payload) : undefined
  const models = fromOption.length > 0 ? fromOption : fromLegacy?.models ?? []
  const currentFromOption = typeof asRecord(modelOption)?.currentValue === 'string'
    ? asRecord(modelOption)?.currentValue as string
    : ''
  const currentModel = currentFromOption
    || fromLegacy?.current
    || models[0]?.id
    || provider
  const resolved = models.some(model => model.id === currentModel)
    ? models
    : [{ id: currentModel, name: currentModel }, ...models]
  const thoughtChoices = thoughtOption
    ? flattenSelectChoices(asRecord(thoughtOption)?.options)
    : []
  const thoughtCurrent = typeof asRecord(thoughtOption)?.currentValue === 'string'
    ? asRecord(thoughtOption)?.currentValue as string
    : undefined
  const catalog: ProjectedCatalog = {
    provider,
    providerName: PROVIDER_LABEL[provider],
    models: resolved.length > 0 ? resolved : fallbackCatalog(provider).models,
    currentModel,
    modelConfigId: modelOption ? configOptionId(modelOption) || 'model' : 'model',
  }
  if (thoughtOption && thoughtChoices.length > 0) {
    catalog.reasoning = {
      configId: configOptionId(thoughtOption) || 'reasoning_effort',
      efforts: thoughtChoices,
      ...thoughtCurrent === undefined ? {} : { current: thoughtCurrent },
      ...thoughtCurrent === undefined ? {} : { defaultEffort: thoughtCurrent },
    }
  }
  return catalog
}

export function lastModelSelection(
  events: ReadonlyArray<{ type: string; data: unknown }>,
): HostModelSelection | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'model/selection') continue
    const data = asRecord(event.data)
    if (!data) continue
    if (typeof data.provider !== 'string' || !data.provider) continue
    if (typeof data.model !== 'string' || !data.model) continue
    return {
      provider: data.provider,
      model: data.model,
      ...typeof data.reasoningEffort === 'string' && data.reasoningEffort
        ? { reasoningEffort: data.reasoningEffort }
        : {},
    }
  }
  return undefined
}

export function selectionEquals(left: HostModelSelection | undefined, right: HostModelSelection | undefined): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return left.provider === right.provider
    && left.model === right.model
    && left.reasoningEffort === right.reasoningEffort
}

/**
 * Catalog-only adapter. The host picker / `selectModel` / prompt admission
 * read this; generation stays on the ACP child. `stream` throws if the host
 * ever tries a DeepSeek-style token loop.
 */
export class AcpCatalogAdapter {
  private readonly catalogs = new Map<ProviderId, ProjectedCatalog>()

  replace(catalog: ProjectedCatalog): void {
    this.catalogs.set(catalog.provider, catalog)
  }

  projected(provider: string): ProjectedCatalog | undefined {
    return this.catalogs.get(provider as ProviderId)
  }

  advertisedProviders(): ProviderId[] {
    return PROVIDER_IDS.filter(id => this.catalogs.has(id))
  }

  providerInfo(provider: string): { id: string; name: string } {
    const known = this.catalogs.get(provider as ProviderId)
    return {
      id: provider,
      name: known?.providerName ?? PROVIDER_LABEL[provider as ProviderId] ?? provider,
    }
  }

  listModels(provider: string): Promise<Array<{
    provider: string
    id: string
    name: string
    description?: string
  }>> {
    const catalog = this.catalogs.get(provider as ProviderId)
    return Promise.resolve((catalog?.models ?? []).map(model => ({
      provider,
      id: model.id,
      name: model.name,
      ...model.description === undefined ? {} : { description: model.description },
    })))
  }

  resolveModel(provider: string, model: string): Promise<{
    provider: string
    id: string
    name: string
    description?: string
    reasoning?: {
      efforts: Array<{ id: string; name: string; description?: string }>
      defaultEffort?: string
    }
  }> {
    const catalog = this.catalogs.get(provider as ProviderId)
    const found = catalog?.models.find(entry => entry.id === model)
    const reasoning = catalog?.reasoning
    return Promise.resolve({
      provider,
      id: model,
      name: found?.name ?? model,
      ...found?.description === undefined ? {} : { description: found.description },
      ...reasoning === undefined ? {} : {
        reasoning: {
          efforts: reasoning.efforts.map(effort => ({
            id: effort.id,
            name: effort.name,
            ...effort.description === undefined ? {} : { description: effort.description },
          })),
          ...reasoning.defaultEffort === undefined ? {} : { defaultEffort: reasoning.defaultEffort },
        },
      },
    })
  }

  async *stream(): AsyncIterable<never> {
    throw new Error(
      'lumine-acp-session: catalog adapter does not generate; the official ACP child owns the turn',
    )
  }
}

/**
 * Registers the catalog adapter on `ctx.llm` for whichever ACP products have
 * advertised models. Host `session.models` / `routeServed` read this registry.
 */
export class AcpCatalogRegistry {
  readonly adapter = new AcpCatalogAdapter()
  private handle: AdapterRegistrationHandle | undefined

  constructor(private readonly llm: LlmRegistry | undefined) {}

  publish(catalog: ProjectedCatalog): void {
    this.adapter.replace(catalog)
    const providers = this.adapter.advertisedProviders()
    if (providers.length === 0) return
    try {
      if (this.handle === undefined) {
        this.handle = this.llm?.registerAdapter(providers, this.adapter)
      } else {
        this.handle.replace(providers)
      }
    } catch (error: unknown) {
      // A conflicting host adapter for the same id is unexpected; keep local
      // projection so select/prompt mapping still has a source of truth.
      void error
    }
  }
}

/** Test helper: what the web picker would show after our projection. */
export function pickerSnapshot(
  adapter: AcpCatalogAdapter,
  current: HostModelSelection,
): {
  current: HostModelSelection
  routable: boolean
  groups: Array<{ id: string; name: string; models: CatalogModel[] }>
} {
  const providers = adapter.advertisedProviders()
  return {
    current,
    routable: providers.includes(current.provider as ProviderId),
    groups: providers.map((id) => {
      const catalog = adapter.projected(id)
      return {
        id,
        name: catalog?.providerName ?? PROVIDER_LABEL[id],
        models: catalog?.models ?? [],
      }
    }).filter(group => group.models.length > 0),
  }
}
