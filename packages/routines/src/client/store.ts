import type { Routine } from '../types.ts'
import { createRoutineWire, type RoutineRpc, type RoutineWire } from './rpc.ts'
import {
  draftFromRoutine, draftReady, emptyDraft, rowView, toCreateInput, toUpdateInput,
  type RoutineDraft, type RoutineRowView,
} from './view.ts'

export type RoutinesStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface RoutinesState {
  readonly status: RoutinesStatus
  readonly open: boolean
  readonly routines: readonly Routine[]
  readonly rows: readonly RoutineRowView[]
  readonly selectedId: string | null
  readonly creating: boolean
  readonly draft: RoutineDraft | null
  readonly busyId: string | null
  readonly error: string | null
}

const INITIAL: RoutinesState = {
  status: 'idle',
  open: false,
  routines: [],
  rows: [],
  selectedId: null,
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

  openPane(): void {
    this.set({ open: true })
    if (this.state.status === 'idle') void this.load()
  }

  closePane(): void {
    this.set({ open: false })
  }

  togglePane(): void {
    if (this.state.open) this.closePane()
    else this.openPane()
  }

  async load(): Promise<void> {
    if (this.state.status === 'idle') this.set({ status: 'loading' })
    try {
      const listed = await this.wire.list()
      const routines = listed.routines
      const selectedId = this.state.selectedId
      const stillThere = selectedId !== null && routines.some(row => row.id === selectedId)
      this.set({
        status: 'ready',
        routines,
        rows: routines.map(rowView),
        error: null,
        ...stillThere ? {} : { selectedId: null, ...this.state.creating ? {} : { draft: null } },
      })
    } catch (error) {
      this.set({
        status: this.state.rows.length > 0 ? 'ready' : 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  select(id: string): void {
    const routine = this.state.routines.find(row => row.id === id)
    if (!routine) return
    this.set({
      selectedId: id,
      creating: false,
      draft: draftFromRoutine(routine),
      error: null,
    })
  }

  beginCreate(): void {
    this.set({
      creating: true,
      selectedId: null,
      draft: emptyDraft(),
      error: null,
    })
  }

  cancelCreate(): void {
    const selected = this.state.selectedId
      ? this.state.routines.find(row => row.id === this.state.selectedId)
      : undefined
    this.set({
      creating: false,
      draft: selected ? draftFromRoutine(selected) : null,
    })
  }

  setDraft(patch: Partial<RoutineDraft>): void {
    const draft = this.state.draft ?? emptyDraft()
    this.set({ draft: { ...draft, ...patch } })
  }

  async confirmCreate(): Promise<void> {
    return this.confirmSave()
  }

  async confirmSave(): Promise<void> {
    const draft = this.state.draft
    if (draft === null || !draftReady(draft)) return
    if (this.state.creating || this.state.selectedId === null) {
      const input = toCreateInput(draft)
      if (input === undefined) return
      this.set({ busyId: 'create' })
      try {
        const created = await this.wire.create(input)
        this.set({ creating: false, draft: null, busyId: null, selectedId: created.routine.id })
        await this.load()
        const routine = this.state.routines.find(row => row.id === created.routine.id)
        if (routine) this.set({ draft: draftFromRoutine(routine), selectedId: routine.id, creating: false })
      } catch (error) {
        this.set({
          busyId: null,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      return
    }
    const input = toUpdateInput(draft)
    if (input === undefined) return
    const id = this.state.selectedId
    this.set({ busyId: id })
    try {
      await this.wire.update(id, input)
      this.set({ busyId: null, error: null })
      await this.load()
      const routine = this.state.routines.find(row => row.id === id)
      if (routine) this.set({ draft: draftFromRoutine(routine), selectedId: id, creating: false })
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
      const clearing = this.state.selectedId === id
      this.set({
        busyId: null,
        error: null,
        ...clearing ? { selectedId: null, draft: null, creating: false } : {},
      })
      await this.load()
    } catch (error) {
      this.set({
        busyId: null,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
