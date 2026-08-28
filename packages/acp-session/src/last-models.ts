/**
 * Durable last-used model per ACP product. Host `agent-default-model` is one
 * global slot, so Claude→Grok→Claude would forget Sonnet. This file remembers
 * each product's pick across sessions and blank-session agent swaps.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { HostModelSelection } from './models.ts'
import { isProviderId, type ProviderId } from './providers.ts'

function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DSH_HOME?.trim()
  if (fromEnv) {
    if (fromEnv === '~') return homedir()
    if (fromEnv.startsWith('~/') || fromEnv.startsWith('~\\')) return join(homedir(), fromEnv.slice(2))
    return fromEnv
  }
  return join(homedir(), '.dsh')
}

export interface RememberedSelection {
  model: string
  reasoningEffort?: string
}

export interface LastModelsState {
  version: 1
  byProvider: Partial<Record<ProviderId, RememberedSelection>>
}

const EMPTY: LastModelsState = { version: 1, byProvider: {} }

export function lastModelsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(env), '.lumine-acp-session', 'last-models.json')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function parseLastModels(raw: string): LastModelsState {
  try {
    const parsed = asRecord(JSON.parse(raw))
    if (parsed === undefined || parsed.version !== 1) return { ...EMPTY, byProvider: {} }
    const byProvider: LastModelsState['byProvider'] = {}
    const block = asRecord(parsed.byProvider) ?? {}
    for (const [id, entry] of Object.entries(block)) {
      if (!isProviderId(id)) continue
      const row = asRecord(entry)
      const model = typeof row?.model === 'string' ? row.model.trim() : ''
      if (!model) continue
      const effort = typeof row.reasoningEffort === 'string' && row.reasoningEffort
        ? row.reasoningEffort
        : undefined
      byProvider[id] = {
        model,
        ...effort === undefined ? {} : { reasoningEffort: effort },
      }
    }
    return { version: 1, byProvider }
  } catch {
    return { ...EMPTY, byProvider: {} }
  }
}

export class LastModelsStore {
  private cache: LastModelsState | undefined

  constructor(readonly file: string) {}

  recall(provider: string): RememberedSelection | undefined {
    if (!isProviderId(provider)) return undefined
    return this.load().byProvider[provider]
  }

  remember(selection: HostModelSelection): void {
    if (!isProviderId(selection.provider) || !selection.model.trim()) return
    const state = this.load()
    const previous = state.byProvider[selection.provider]
    const next: RememberedSelection = {
      model: selection.model,
      ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
    }
    if (previous?.model === next.model && previous?.reasoningEffort === next.reasoningEffort) return
    state.byProvider[selection.provider] = next
    this.persist(state)
  }

  private load(): LastModelsState {
    if (this.cache !== undefined) return this.cache
    try {
      this.cache = parseLastModels(readFileSync(this.file, 'utf8'))
    } catch {
      this.cache = { version: 1, byProvider: {} }
    }
    return this.cache
  }

  private persist(state: LastModelsState): void {
    this.cache = state
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`)
    renameSync(tmp, this.file)
  }
}

export function createLastModelsStore(env: NodeJS.ProcessEnv = process.env): LastModelsStore {
  return new LastModelsStore(lastModelsPath(env))
}
