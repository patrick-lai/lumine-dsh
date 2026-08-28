import type { CreateRoutineInput, Routine, UpdateRoutineInput } from '../types.ts'

export interface RoutineRpc {
  call(
    route: string,
    endpoint: string,
    payload: { args: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<unknown>
}

export interface RoutineWire {
  list(): Promise<{ routines: Routine[] }>
  create(input: CreateRoutineInput): Promise<{ routine: Routine }>
  update(id: string, input: UpdateRoutineInput): Promise<{ routine: Routine }>
  delete(id: string): Promise<{ deleted: Routine }>
  enable(id: string, enabled: boolean): Promise<{ routine: Routine }>
  runNow(id: string): Promise<{ routine?: Routine; sessionId?: string }>
}

function unwrap(result: unknown): unknown {
  if (result !== null && typeof result === 'object' && 'ok' in result) {
    const envelope = result as { ok: boolean; value?: unknown; error?: { message?: string } }
    if (envelope.ok === false) {
      throw new Error(envelope.error?.message ?? 'routine rpc failed')
    }
    return envelope.value
  }
  return result
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`routine ${label} returned an unexpected payload`)
  }
  return value as Record<string, unknown>
}

export function createRoutineWire(rpc: RoutineRpc): RoutineWire {
  const invoke = async (method: string, args: Record<string, unknown> = {}): Promise<unknown> =>
    unwrap(await rpc.call('/api', `routine/${method}`, { args }))

  return {
    async list() {
      const payload = asObject(await invoke('list'), 'list')
      const routines = payload.routines
      return { routines: Array.isArray(routines) ? routines as Routine[] : [] }
    },
    async create(input) {
      const payload = asObject(await invoke('create', { input }), 'create')
      return { routine: payload.routine as Routine }
    },
    async update(id, input) {
      const payload = asObject(await invoke('update', { id, input }), 'update')
      return { routine: payload.routine as Routine }
    },
    async delete(id) {
      const payload = asObject(await invoke('delete', { id }), 'delete')
      return { deleted: payload.deleted as Routine }
    },
    async enable(id, enabled) {
      const payload = asObject(await invoke('enable', { id, enabled }), 'enable')
      return { routine: payload.routine as Routine }
    },
    async runNow(id) {
      const payload = asObject(await invoke('runNow', { id }), 'runNow')
      return {
        ...payload.sessionId ? { sessionId: String(payload.sessionId) } : {},
        ...payload.routine ? { routine: payload.routine as Routine } : {},
      }
    },
  }
}
