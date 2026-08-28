import { PROVIDER_IDS, PROVIDER_LABEL, type ProviderId } from './providers.ts'

/** How `session/set_config_option` names the thing we are changing. */
export type ConfigSetStyle = 'select' | 'option-id'

export interface CatalogEffortList {
  efforts: Array<{ id: string; name: string; description?: string }>
  defaultEffort?: string
}

/** One selectable model projected from ACP modelState / config options. */
export interface CatalogModel {
  id: string
  name: string
  description?: string
  reasoning?: CatalogEffortList
}

export interface CatalogReasoning extends CatalogEffortList {
  configId: string
  setStyle: ConfigSetStyle
  current?: string
}

/**
 * Session model catalog the DSH web picker already reads, sourced from the
 * child's advertised models (Grok: session/new `models` + `_meta.x.ai/sessionConfig`).
 */
export interface ProjectedCatalog {
  provider: ProviderId
  providerName: string
  models: CatalogModel[]
  currentModel: string
  modelConfigId: string
  modelSetStyle: ConfigSetStyle
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

export interface CatalogLogger {
  warn?(...args: unknown[]): void
  error?(...args: unknown[]): void
}

export interface LlmRegistry {
  registerAdapter(providers: string[], adapter: AcpCatalogAdapter): AdapterRegistrationHandle
  listProviders?(): Array<{ id: string; name?: string }>
  listModels?(provider: string): Promise<Array<{ provider: string; id: string; name: string; description?: string }>>
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** ACP v1 uses `id`; v2 uses `configId`. Grok flat options use `id` as the value. */
export function configOptionId(option: unknown): string {
  const record = asRecord(option)
  if (!record) return ''
  if (typeof record.id === 'string' && record.id) return record.id
  if (typeof record.configId === 'string' && record.configId) return record.configId
  return ''
}

function hasNestedChoices(option: unknown): boolean {
  const record = asRecord(option)
  return Array.isArray(record?.options) && record.options.length > 0
}

/** Standard ACP select parent (`id: "model"`, nested `options`). */
export function isModelSelectOption(option: unknown): boolean {
  const record = asRecord(option)
  if (!record || !hasNestedChoices(record)) return false
  const id = configOptionId(record)
  return record.category === 'model' || id === 'model'
}

export function isThoughtSelectOption(option: unknown): boolean {
  const record = asRecord(option)
  if (!record || !hasNestedChoices(record)) return false
  const id = configOptionId(record)
  return record.category === 'thought_level'
    || id === 'reasoning_effort'
    || id === 'thought_level'
}

export function isModelConfigOption(option: unknown): boolean {
  return isModelSelectOption(option)
}

export function isThoughtConfigOption(option: unknown): boolean {
  return isThoughtSelectOption(option)
}

function choiceFrom(item: unknown): CatalogModel | undefined {
  const record = asRecord(item)
  if (!record) return undefined
  const id = typeof record.value === 'string' && record.value
    ? record.value
    : typeof record.modelId === 'string' && record.modelId
      ? record.modelId
      : typeof record.id === 'string' && record.id
        ? record.id
        : ''
  if (!id) return undefined
  const name = typeof record.name === 'string' && record.name
    ? record.name
    : typeof record.label === 'string' && record.label
      ? record.label
      : id
  const description = typeof record.description === 'string' && record.description
    ? record.description
    : undefined
  const reasoning = reasoningFromModel(record)
  return {
    id,
    name,
    ...description === undefined ? {} : { description },
    ...reasoning === undefined ? {} : { reasoning },
  }
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

function catalogRoots(payload: unknown): Record<string, unknown>[] {
  if (payload === undefined || payload === null) return []
  if (Array.isArray(payload)) {
    const looksLikeSources = payload.some(item => {
      const rec = asRecord(item)
      return rec !== undefined && (
        rec.modelState !== undefined
        || rec.models !== undefined
        || rec._meta !== undefined
        || rec.protocolVersion !== undefined
        || rec.sessionId !== undefined
        || rec.configOptions !== undefined
      )
    })
    if (looksLikeSources) return payload.flatMap(catalogRoots)
    return []
  }
  const record = asRecord(payload)
  return record === undefined ? [] : [record]
}

function sessionConfigOptions(record: Record<string, unknown>): unknown[] {
  const meta = asRecord(record._meta)
  if (!meta) return []
  for (const key of ['x.ai/sessionConfig', 'sessionConfig']) {
    const block = asRecord(meta[key])
    if (Array.isArray(block?.options)) return block.options
    if (Array.isArray(meta[key])) return meta[key] as unknown[]
  }
  return []
}

export function collectConfigOptions(payload: unknown): unknown[] {
  const out: unknown[] = []
  for (const root of catalogRoots(payload)) {
    if (Array.isArray(root.configOptions)) out.push(...root.configOptions)
    out.push(...sessionConfigOptions(root))
  }
  if (out.length === 0 && Array.isArray(payload)) return payload
  return out
}

function effortChoice(item: unknown): { id: string; name: string; description?: string; default?: boolean } | undefined {
  const record = asRecord(item)
  if (!record) {
    if (typeof item === 'string' && item) return { id: item, name: item }
    return undefined
  }
  const id = typeof record.id === 'string' && record.id
    ? record.id
    : typeof record.value === 'string' && record.value
      ? record.value
      : ''
  if (!id) return undefined
  const name = typeof record.name === 'string' && record.name
    ? record.name
    : typeof record.label === 'string' && record.label
      ? record.label
      : id
  const description = typeof record.description === 'string' && record.description
    ? record.description
    : undefined
  return {
    id,
    name,
    ...description === undefined ? {} : { description },
    ...record.default === true ? { default: true } : {},
  }
}

function reasoningFromModel(record: Record<string, unknown>): CatalogModel['reasoning'] | undefined {
  const meta = asRecord(record._meta)
  const raw = record.reasoningEfforts ?? record.reasoning ?? meta?.reasoningEfforts ?? meta?.reasoning
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const efforts = raw.map(effortChoice).filter((item): item is NonNullable<typeof item> => item !== undefined)
  if (efforts.length === 0) return undefined
  const marked = efforts.find(item => item.default)?.id
  const metaDefault = typeof meta?.reasoningEffort === 'string' ? meta.reasoningEffort : undefined
  const defaultEffort = marked ?? metaDefault
  return {
    efforts: efforts.map(({ id, name, description }) => ({
      id,
      name,
      ...description === undefined ? {} : { description },
    })),
    ...defaultEffort === undefined ? {} : { defaultEffort },
  }
}

function modelStateBlock(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const direct = asRecord(record.modelState) ?? asRecord(record.models)
  if (direct) return direct
  const meta = asRecord(record._meta)
  return asRecord(meta?.modelState) ?? asRecord(meta?.models)
}

/** advertised `models` / `modelState` (`currentModelId` + `availableModels`). */
export function advertisedModelState(payload: unknown): { models: CatalogModel[]; current?: string } | undefined {
  let current: string | undefined
  const models: CatalogModel[] = []
  const seen = new Set<string>()
  for (const root of catalogRoots(payload)) {
    const block = modelStateBlock(root)
    const list = Array.isArray(block?.availableModels)
      ? block.availableModels
      : Array.isArray(root.availableModels)
        ? root.availableModels
        : Array.isArray(root.models)
          ? root.models
          : undefined
    if (Array.isArray(list)) {
      for (const item of list) {
        const choice = choiceFrom(item)
        if (!choice || seen.has(choice.id)) continue
        seen.add(choice.id)
        models.push(choice)
      }
    }
    const blockCurrent = typeof block?.currentModelId === 'string' && block.currentModelId
      ? block.currentModelId
      : typeof root.currentModelId === 'string' && root.currentModelId
        ? root.currentModelId
        : undefined
    if (blockCurrent) current = blockCurrent
  }
  return models.length > 0 || current !== undefined ? { models, current } : undefined
}

/** Older name kept for tests. */
export function legacyModels(payload: unknown): { models: CatalogModel[]; current?: string } | undefined {
  return advertisedModelState(payload)
}

function flatCategoryChoices(options: unknown[], category: string): {
  models: CatalogModel[]
  current?: string
} {
  const models: CatalogModel[] = []
  const seen = new Set<string>()
  let current: string | undefined
  for (const option of options) {
    const record = asRecord(option)
    if (!record || record.category !== category || hasNestedChoices(record)) continue
    const choice = choiceFrom(record)
    if (!choice) continue
    if (record.selected === true) current = choice.id
    if (seen.has(choice.id)) continue
    seen.add(choice.id)
    models.push(choice)
  }
  return { models, current }
}

export function hasCatalogHints(payload: unknown): boolean {
  for (const root of catalogRoots(payload)) {
    if (Array.isArray(root.configOptions) && root.configOptions.length > 0) return true
    if (sessionConfigOptions(root).length > 0) return true
    if (modelStateBlock(root) !== undefined) return true
    if (root.availableModels !== undefined || root.currentModelId !== undefined) return true
  }
  return false
}

const GROK_MODE_EFFORTS = [
  { id: 'xhigh', name: 'X-High' },
  { id: 'high', name: 'High' },
  { id: 'medium', name: 'Medium' },
  { id: 'low', name: 'Low' },
] as const

const CLAUDE_EFFORTS = [
  { id: 'default', name: 'Default' },
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
  { id: 'xhigh', name: 'Xhigh' },
  { id: 'max', name: 'Max' },
] as const

/**
 * Live Grok Build 1.0.5 catalog (initialize.modelState + session/new).
 * Seed this at plugin apply so `session.models` is Grok 4.6/4.5 before the
 * child is spawned. Do not invent grok-4 / grok-3 ids.
 */
export function grokSeedCatalog(): ProjectedCatalog {
  return {
    provider: 'grok',
    providerName: PROVIDER_LABEL.grok,
    models: [
      {
        id: 'grok-4.6',
        name: 'Grok 4.6',
        reasoning: {
          efforts: GROK_MODE_EFFORTS.map(effort => ({ ...effort })),
          defaultEffort: 'high',
        },
      },
      {
        id: 'grok-4.5',
        name: 'Grok 4.5',
        reasoning: {
          efforts: GROK_MODE_EFFORTS.filter(effort => effort.id !== 'xhigh').map(effort => ({ ...effort })),
          defaultEffort: 'high',
        },
      },
    ],
    currentModel: 'grok-4.6',
    modelConfigId: 'grok-4.6',
    modelSetStyle: 'option-id',
    reasoning: {
      configId: 'high',
      setStyle: 'option-id',
      efforts: GROK_MODE_EFFORTS.map(effort => ({ ...effort })),
      current: 'high',
      defaultEffort: 'high',
    },
  }
}

/**
 * Live Claude Code ACP 0.70 catalog (`session/new` configOptions).
 * `currentValue` is the ACP `default` alias, not a DeepSeek or Grok id.
 */
export function claudeSeedCatalog(): ProjectedCatalog {
  return {
    provider: 'claude',
    providerName: PROVIDER_LABEL.claude,
    models: [
      { id: 'default', name: 'Default (recommended)', description: 'Opus (1M context)' },
      { id: 'opus[1m]', name: 'Opus (1M context)', description: 'Opus 5 with 1M context' },
      { id: 'claude-fable-5[1m]', name: 'Fable', description: 'Fable 5' },
      { id: 'sonnet', name: 'Sonnet', description: 'Sonnet 5' },
      { id: 'haiku', name: 'Haiku', description: 'Haiku 4.5' },
    ],
    currentModel: 'default',
    modelConfigId: 'model',
    modelSetStyle: 'select',
    reasoning: {
      configId: 'effort',
      setStyle: 'select',
      efforts: CLAUDE_EFFORTS.map(effort => ({ ...effort })),
      current: 'default',
      defaultEffort: 'default',
    },
  }
}

/** Typical ACP v1 `configOptions` select (`id: "model"`) used by Cursor. */
export function cursorSeedCatalog(): ProjectedCatalog {
  return {
    provider: 'cursor',
    providerName: PROVIDER_LABEL.cursor,
    models: [
      { id: 'composer-2', name: 'Composer 2' },
      { id: 'gpt-5', name: 'GPT-5' },
    ],
    currentModel: 'composer-2',
    modelConfigId: 'model',
    modelSetStyle: 'select',
  }
}

export function fallbackCatalog(provider: ProviderId): ProjectedCatalog {
  if (provider === 'grok') return grokSeedCatalog()
  if (provider === 'claude') return claudeSeedCatalog()
  if (provider === 'cursor') return cursorSeedCatalog()
  return {
    provider,
    providerName: PROVIDER_LABEL[provider],
    models: [{ id: provider, name: PROVIDER_LABEL[provider] }],
    currentModel: provider,
    modelConfigId: 'model',
    modelSetStyle: 'select',
  }
}

export function selectionFromCatalog(catalog: ProjectedCatalog): HostModelSelection {
  return {
    provider: catalog.provider,
    model: catalog.currentModel,
    ...catalog.reasoning?.current === undefined ? {} : { reasoningEffort: catalog.reasoning.current },
  }
}

/**
 * Last-used pick for this ACP product when it is still advertised; otherwise
 * the catalog default. Effort is kept only when that model still lists it.
 */
export function selectionForAgent(
  catalog: ProjectedCatalog,
  remembered?: { model: string; reasoningEffort?: string },
): HostModelSelection {
  const known = remembered !== undefined && catalog.models.some(model => model.id === remembered.model)
  if (!known || remembered === undefined) return selectionFromCatalog(catalog)
  const entry = catalog.models.find(model => model.id === remembered.model)
  const efforts = entry?.reasoning?.efforts ?? catalog.reasoning?.efforts ?? []
  const effort = remembered.reasoningEffort !== undefined
    && efforts.some(item => item.id === remembered.reasoningEffort)
    ? remembered.reasoningEffort
    : entry?.reasoning?.defaultEffort ?? catalog.reasoning?.current ?? catalog.reasoning?.defaultEffort
  return {
    provider: catalog.provider,
    model: remembered.model,
    ...effort === undefined ? {} : { reasoningEffort: effort },
  }
}

/**
 * Route written into `request/header` / `request/context`. Never pair an ACP
 * provider with the host default model (`deepseek-v4-flash` arrives on
 * `agentOptions.model` from `agentDefaultModel`).
 */
export function catalogRoute(
  catalog: ProjectedCatalog,
  selected?: HostModelSelection,
): { provider: ProviderId; model: string } {
  const hinted = selected?.provider === catalog.provider ? selected.model : undefined
  const known = hinted !== undefined && catalog.models.some(model => model.id === hinted)
  return {
    provider: catalog.provider,
    model: known ? hinted : catalog.currentModel,
  }
}

/** Host `routeServed` — only `ctx.llm.listProviders()`, not our local map. */
export function hostServesProvider(
  llm: { listProviders?: () => Array<{ id: string }> } | undefined,
  provider: string,
): boolean {
  try {
    return llm?.listProviders?.().some(entry => entry.id === provider) === true
  } catch {
    return false
  }
}

/**
 * Host `selectionFor(agent).current` fold (dsh-host-apiproxy):
 * 1. in-process `selectModel` pick
 * 2. `session.requestHeader()?.config` (from turn-enclosed `request/header`)
 * 3. global `agent-default-model` (DeepSeek, or last `saveSelection`)
 *
 * DSH does **not** read a `model/selection` event. That type is also absent
 * from `KNOWN_SESSION_EVENT_TYPES`, so appending it poisons resume. This
 * plugin wraps `requestHeader()` so step 2 is the ACP product before the
 * first prompt writes a real header.
 */
export function hostSelectionCurrent(input: {
  picked?: HostModelSelection
  requestHeader?: HostModelSelection
  defaultSelection: HostModelSelection
}): HostModelSelection {
  return input.picked ?? input.requestHeader ?? input.defaultSelection
}

function mergeModels(layers: CatalogModel[][]): CatalogModel[] {
  const byId = new Map<string, CatalogModel>()
  for (const layer of layers) {
    for (const model of layer) {
      const previous = byId.get(model.id)
      byId.set(model.id, {
        ...previous,
        ...model,
        reasoning: model.reasoning ?? previous?.reasoning,
        name: model.name && model.name !== model.id ? model.name : previous?.name ?? model.name,
      })
    }
  }
  return [...byId.values()]
}

export function projectAcpModels(
  provider: ProviderId,
  payload: unknown,
): ProjectedCatalog {
  const options = collectConfigOptions(payload)
  const modelSelect = options.find(isModelSelectOption)
  const thoughtSelect = options.find(isThoughtSelectOption)
  const fromSelect = modelSelect ? flattenSelectChoices(asRecord(modelSelect)?.options) : []
  const fromState = advertisedModelState(payload)
  const fromFlatModel = flatCategoryChoices(options, 'model')
  const models = mergeModels([
    fromState?.models ?? [],
    fromFlatModel.models,
    fromSelect,
  ])
  const currentFromSelect = typeof asRecord(modelSelect)?.currentValue === 'string'
    ? asRecord(modelSelect)?.currentValue as string
    : ''
  if (models.length === 0 && !fromFlatModel.current && !currentFromSelect && !fromState?.current) {
    return fallbackCatalog(provider)
  }
  const currentModel = fromFlatModel.current
    || currentFromSelect
    || fromState?.current
    || models[0]?.id
    || provider
  const resolved = models.some(model => model.id === currentModel)
    ? models
    : models.length === 0
      ? fallbackCatalog(provider).models
      : [{ id: currentModel, name: currentModel }, ...models]

  const flatMode = flatCategoryChoices(options, 'mode')
  const thoughtChoices = thoughtSelect
    ? flattenSelectChoices(asRecord(thoughtSelect)?.options)
    : []
  const thoughtCurrent = typeof asRecord(thoughtSelect)?.currentValue === 'string'
    ? asRecord(thoughtSelect)?.currentValue as string
    : undefined
  const currentEntry = resolved.find(model => model.id === currentModel)
  const fromModelReasoning = currentEntry?.reasoning

  const catalog: ProjectedCatalog = {
    provider,
    providerName: PROVIDER_LABEL[provider],
    models: resolved,
    currentModel,
    modelConfigId: modelSelect
      ? configOptionId(modelSelect) || 'model'
      : fromFlatModel.models.length > 0
        ? currentModel
        : 'model',
    modelSetStyle: modelSelect ? 'select' : fromFlatModel.models.length > 0 ? 'option-id' : 'select',
  }

  if (thoughtSelect && thoughtChoices.length > 0) {
    catalog.reasoning = {
      configId: configOptionId(thoughtSelect) || 'reasoning_effort',
      setStyle: 'select',
      efforts: thoughtChoices,
      ...thoughtCurrent === undefined ? {} : { current: thoughtCurrent },
      defaultEffort: thoughtCurrent ?? fromModelReasoning?.defaultEffort,
    }
  } else if (flatMode.models.length > 0) {
    catalog.reasoning = {
      configId: flatMode.current ?? 'mode',
      setStyle: 'option-id',
      efforts: flatMode.models.map(model => ({
        id: model.id,
        name: model.name,
        ...model.description === undefined ? {} : { description: model.description },
      })),
      ...flatMode.current === undefined ? {} : { current: flatMode.current },
      defaultEffort: fromModelReasoning?.defaultEffort ?? flatMode.current,
    }
  } else if (fromModelReasoning) {
    catalog.reasoning = {
      configId: 'mode',
      setStyle: 'option-id',
      ...fromModelReasoning,
      current: fromModelReasoning.defaultEffort,
    }
  }
  return catalog
}

export function configIdForModel(catalog: ProjectedCatalog, model: string): string {
  return catalog.modelSetStyle === 'option-id' ? model : catalog.modelConfigId
}

export function configIdForReasoning(catalog: ProjectedCatalog, effort: string): string {
  if (!catalog.reasoning) return effort
  return catalog.reasoning.setStyle === 'option-id' ? effort : catalog.reasoning.configId
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

  /**
   * Host `LlmRuntime.prepareRoutes` calls this and defaults with `??`.
   * A missing method is a TypeError; the effect fails and grok never
   * lands in `listProviders()`.
   */
  providerRetryPolicy(_provider: string): undefined {
    return undefined
  }

  imageRequestPricing(_provider: string, _model: string): undefined {
    return undefined
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

  resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<{
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
    const reasoning = found?.reasoning ?? catalog?.reasoning
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

  async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<{
    model: Awaited<ReturnType<AcpCatalogAdapter['resolveModel']>>
    stream: (options?: unknown) => AsyncIterable<never>
  }> {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: options => this.stream(options),
    }
  }

  async *stream(_options?: unknown): AsyncIterable<never> {
    throw new Error(
      'lumine-acp-session: catalog adapter does not generate; the official ACP child owns the turn',
    )
  }
}

/**
 * Registers the catalog adapter on `ctx.llm` for whichever ACP products have
 * advertised models. Host `session.models` / `routeServed` read this registry.
 * Call {@link seedDefaults} at plugin apply / factory construct — not only
 * after the ACP child handshake — so `listProviders()` already contains
 * `grok` before `session.create`.
 */
export class AcpCatalogRegistry {
  readonly adapter = new AcpCatalogAdapter()
  private handle: AdapterRegistrationHandle | undefined

  constructor(
    private readonly llm: LlmRegistry | undefined,
    private readonly logger?: CatalogLogger,
  ) {}

  /**
   * Advertise every ACP product with a seed catalog. Grok uses the live 1.0.5
   * gold (grok-4.6 / grok-4.5). Claude Code uses the live ACP 0.70 select
   * (`default` / opus / sonnet / haiku). Other products use a labeled
   * placeholder until that child's initialize + session/new replaces it.
   *
   * Call from plugin `apply` via {@link mountAcpCatalog} — `registerAdapter`
   * uses `ctx.effect`, and the factory constructor fiber is still LOADING.
   */
  seedDefaults(): void {
    for (const provider of PROVIDER_IDS) {
      if (this.adapter.projected(provider) === undefined) {
        this.adapter.replace(fallbackCatalog(provider))
      }
    }
    this.syncRegistration()
  }

  publish(catalog: ProjectedCatalog): void {
    this.adapter.replace(catalog)
    this.syncRegistration()
  }

  dispose(): void {
    const handle = this.handle
    this.handle = undefined
    try {
      handle?.()
    } catch (error: unknown) {
      void error
    }
  }

  private syncRegistration(): void {
    const providers = this.adapter.advertisedProviders()
    if (providers.length === 0) return
    if (this.llm === undefined) {
      this.logger?.error?.(
        'lumine-acp-session: ctx.llm missing; catalog adapter cannot register grok/claude/codex/cursor',
      )
      return
    }
    try {
      if (this.handle === undefined) {
        this.handle = this.llm.registerAdapter(providers, this.adapter)
      } else {
        this.handle.replace(providers)
      }
    } catch (error: unknown) {
      const text = `lumine-acp-session: catalog adapter not registered: ${
        error instanceof Error ? error.message : String(error)
      }`
      this.logger?.error?.(text)
      throw error instanceof Error ? error : new Error(text)
    }
    // registerAdapter is ctx.effect: a failed effect can still return a handle
    // with no routes. routeServed reads listProviders(), not the handle.
    this.assertHostServes(providers)
  }

  private assertHostServes(providers: readonly string[]): void {
    const served = new Set((this.llm?.listProviders?.() ?? []).map(entry => entry.id))
    const missing = providers.filter(provider => !served.has(provider))
    if (missing.length === 0) return
    const text = `lumine-acp-session: ctx.llm.listProviders() missing ${missing.join(', ')} after registerAdapter`
    this.logger?.error?.(text)
    throw new Error(text)
  }
}

/**
 * Register the catalog-only adapter on the host `llm` from plugin `apply`.
 * `routeServed` / `session.models` read that registry, not a factory-local map.
 */
export function mountAcpCatalog(
  ctx: {
    llm?: LlmRegistry
    get?(name: string): unknown
    logger?: CatalogLogger
    effect?(fn: () => (() => unknown) | void, label?: string): unknown
  },
  catalog = new AcpCatalogRegistry(
    (ctx.llm ?? ctx.get?.('llm')) as LlmRegistry | undefined,
    ctx.logger,
  ),
): AcpCatalogRegistry {
  const seed = (): void => { catalog.seedDefaults() }
  if (ctx.effect !== undefined) {
    ctx.effect(() => {
      seed()
      return () => catalog.dispose()
    }, 'lumine-acp-session.catalog')
  } else {
    seed()
  }
  return catalog
}

/**
 * Host `selectionFor().current` reads `session.requestHeader()?.config` when
 * no `selectModel` pick exists. `request/header` itself is turn-enclosed, so
 * wrap the fold: until a real header is logged, report this session's ACP
 * product instead of the host-wide `agent-default-model` (often grok).
 */
export function adoptPickerCurrent(
  session: { requestHeader?: () => unknown },
  selection: () => HostModelSelection,
): void {
  const original = typeof session.requestHeader === 'function'
    ? session.requestHeader.bind(session)
    : (): undefined => undefined
  const wrapped = (): unknown => {
    const logged = asRecord(original())
    const config = asRecord(logged?.config)
    if (typeof config?.provider === 'string' && config.provider
      && typeof config.model === 'string' && config.model) {
      return logged
    }
    const next = selection()
    return {
      config: {
        provider: next.provider,
        model: next.model,
        ...next.reasoningEffort === undefined ? {} : { reasoningEffort: next.reasoningEffort },
      },
    }
  }
  try {
    Object.defineProperty(session, 'requestHeader', { configurable: true, value: wrapped })
  } catch {
    (session as { requestHeader: () => unknown }).requestHeader = wrapped
  }
}

/**
 * Point the host picker at this product before setup's `selectionFor()`.
 * Does **not** append `model/selection` — that type is unknown to DSH
 * persistence and is not the host current-selection fold.
 */
export function seedSessionRoute(
  session: { requestHeader?: () => unknown },
  catalog: ProjectedCatalog,
): HostModelSelection {
  const next = selectionFromCatalog(catalog)
  adoptPickerCurrent(session, () => next)
  return next
}

/**
 * Drop every provider group the current ACP agent cannot serve.
 * Host `session.models` lists the whole llm registry (DeepSeek + every ACP
 * product we seed). The composer picker must not.
 */
export function constrainSessionCatalog<
  G extends { id: string },
  F extends { id: string } = { id: string },
>(
  catalog: { groups: readonly G[]; failures?: readonly F[] },
  provider: string,
): { groups: G[]; failures: F[] } {
  return {
    groups: catalog.groups.filter(group => group.id === provider),
    failures: (catalog.failures ?? []).filter(failure => failure.id === provider),
  }
}

/** Same-provider catalog membership. Cross-product picks are never selectable. */
export function selectionSupportedByAgent(
  agentProvider: string,
  selection: { provider: string; model?: string },
  catalog?: { models: ReadonlyArray<{ id: string }> },
): boolean {
  if (selection.provider !== agentProvider) return false
  if (selection.model === undefined || catalog === undefined || catalog.models.length === 0) return true
  return catalog.models.some(model => model.id === selection.model)
}

/** Test helper: what the web picker would show after our per-agent constraint. */
export function pickerSnapshot(
  adapter: AcpCatalogAdapter,
  current: HostModelSelection,
): {
  current: HostModelSelection
  routable: boolean
  groups: Array<{ id: string; name: string; models: CatalogModel[] }>
} {
  const providers = adapter.advertisedProviders()
  const unconstrained = providers.map((id) => {
    const catalog = adapter.projected(id)
    return {
      id,
      name: catalog?.providerName ?? PROVIDER_LABEL[id],
      models: catalog?.models ?? [],
    }
  }).filter(group => group.models.length > 0)
  const { groups } = constrainSessionCatalog({ groups: unconstrained }, current.provider)
  return {
    current,
    routable: providers.includes(current.provider as ProviderId) && groups.length > 0,
    groups,
  }
}

/**
 * Unfiltered host `session.models` fold: every registered route.
 * The live composer picker runs {@link constrainSessionCatalog} on this.
 */
export async function hostSessionModels(
  llm: {
    listProviders(): Array<{ id: string; name?: string }>
    listModels(provider: string): Promise<Array<{ provider: string; id: string; name: string; description?: string }>>
  },
  current: HostModelSelection,
): Promise<{
  current: HostModelSelection
  routable: boolean
  groups: Array<{ id: string; name: string; models: Array<{ id: string; name: string; description?: string }> }>
}> {
  const providers = llm.listProviders()
  const groups = []
  for (const provider of providers) {
    const models = await llm.listModels(provider.id)
    if (models.length === 0) continue
    groups.push({
      id: provider.id,
      name: provider.name ?? provider.id,
      models: models.map(model => ({
        id: model.id,
        name: model.name,
        ...model.description === undefined ? {} : { description: model.description },
      })),
    })
  }
  return {
    current,
    routable: providers.some(entry => entry.id === current.provider),
    groups,
  }
}
