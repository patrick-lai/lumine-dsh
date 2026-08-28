import type { CreateRoutineInput } from '../types.ts'
import { createRoutineWire, type RoutineRpc, type RoutineWire } from './rpc.ts'
import {
  draftReady, draftRule, emptyDraft, rowView, type CreateDraft, type RoutineRowView,
} from './view.ts'

export type RoutinesStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface RoutinesState {
  readonly status: RoutinesStatus
  readonly rows: readonly RoutineRowView[]
  readonly creating: boolean
  readonly draft: CreateDraft | null
  readonly busyId: string | null
  readonly error: string | null
}

const INITIAL: RoutinesState = {
  status: 'idle',
  rows: [],
  creating: false,
  draft: null,
  busyId: null,
  error: null,
}

export class RoutinesSettingsStore {
  private state: RoutinesState = INITIAL
  private readonly listeners = new Set<() => void>()
  private readonly wire: RoutineWire

  constructor(rpc: RoutineRpc) {
    this.wire = createRoutineWire(rpc)
  }

  readonly store = {
    getSnapshot: (): RoutinesState => this.state,
    subscribe: (listener: () => void): (() => void) => {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    },
  }

  private set(patch: Partial<RoutinesState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  async load(): Promise<void> {
    if (this.state.status === 'idle') this.set({ status: 'loading' })
    try {
      const listed = await this.wire.list()
      this.set({
        status: 'ready',
        rows: listed.routines.map(rowView),
        error: null,
      })
    } catch (error) {
      this.set({
        status: this.state.rows.length > 0 ? 'ready' : 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  beginCreate(): void {
    this.set({ creating: true, draft: emptyDraft(), error: null })
  }

  cancelCreate(): void {
    this.set({ creating: false, draft: null })
  }

  setDraft(patch: Partial<CreateDraft>): void {
    const draft = this.state.draft ?? emptyDraft()
    this.set({ draft: { ...draft, ...patch } })
  }

  async confirmCreate(): Promise<void> {
    const draft = this.state.draft
    if (draft === null || !draftReady(draft)) return
    const rule = draftRule(draft)
    if (rule === undefined) return
    const input: CreateRoutineInput = {
      title: draft.title.trim(),
      promptTemplate: draft.prompt.trim(),
      rule,
    }
    this.set({ busyId: 'create' })
    try {
      await this.wire.create(input)
      this.set({ creating: false, draft: null, busyId: null })
      await this.load()
    } catch (error) {
      this.set({
        busyId: null,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async enable(id: string, enabled: boolean): Promise<void> {
    this.set({ busyId: id })
    try {
      await this.wire.enable(id, enabled)
      this.set({ busyId: null, error: null })
      await this.load()
    } catch (error) {
      this.set({
        busyId: null,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async runNow(id: string): Promise<void> {
    const row = this.state.rows.find(item => item.id === id)
    if (row !== undefined && !row.enabled) {
      this.set({ error: 'Run now is only available while a routine is on.' })
      return
    }
    this.set({ busyId: id })
    try {
      await this.wire.runNow(id)
      this.set({ busyId: null, error: null })
      await this.load()
    } catch (error) {
      this.set({
        busyId: null,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async remove(id: string): Promise<void> {
    this.set({ busyId: id })
    try {
      await this.wire.delete(id)
      this.set({ busyId: null, error: null })
      await this.load()
    } catch (error) {
      this.set({
        busyId: null,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
