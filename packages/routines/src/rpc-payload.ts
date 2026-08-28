import { omitUndefined } from './json.ts'
import type { CreateRoutineInput, Routine, UpdateRoutineInput } from './types.ts'

/** Wire namespace for Settings / Typert. Endpoints are `routine/<method>`. */
export const ROUTINE_RPC_NAMESPACE = 'routine'

export const ROUTINE_RPC_METHODS = ['list', 'create', 'update', 'delete', 'enable', 'runNow'] as const

export type RoutineRpcMethod = (typeof ROUTINE_RPC_METHODS)[number]

export interface RoutineHost {
  list(): Promise<Routine[]> | Routine[]
  create(input: CreateRoutineInput): Promise<Routine>
  update(id: string, input: UpdateRoutineInput): Promise<Routine>
  delete(id: string): Promise<Routine>
  enable(id: string, enabled: boolean): Promise<Routine>
  runNow(id: string): Promise<{ sessionId?: string; routine: Routine } | { sessionId?: string }>
  require?(id: string): Routine
}

export interface RoutineListPayload {
  readonly routines: Routine[]
}

export interface RoutinePausedPayload {
  readonly routine: Routine
  readonly enabled: false
  readonly saved_paused: true
  readonly operator_must_enable: true
}

export interface RoutineRowPayload {
  readonly routine: Routine
}

export interface RoutineDeletedPayload {
  readonly deleted: Routine
}

export interface RoutineRunNowPayload {
  readonly routine?: Routine
  readonly sessionId?: string
}

/**
 * Host RPC results must be lossless JSON. Own enumerable `undefined`
 * (`nextRunAt`, `activeRun`, `sessionId`) is omitted, never written.
 */
export function routineRpcHandlers(host: RoutineHost): {
  list: () => Promise<RoutineListPayload>
  create: (input: CreateRoutineInput) => Promise<RoutinePausedPayload>
  update: (id: string, input: UpdateRoutineInput) => Promise<RoutinePausedPayload>
  delete: (id: string) => Promise<RoutineDeletedPayload>
  enable: (id: string, enabled: boolean) => Promise<RoutineRowPayload>
  runNow: (id: string) => Promise<RoutineRunNowPayload>
} {
  return {
    list: async () => omitUndefined({ routines: await host.list() }),
    create: async (input: CreateRoutineInput) => omitUndefined({
      routine: await host.create(input),
      enabled: false as const,
      saved_paused: true as const,
      operator_must_enable: true as const,
    }),
    update: async (id: string, input: UpdateRoutineInput) => omitUndefined({
      routine: await host.update(id, input),
      enabled: false as const,
      saved_paused: true as const,
      operator_must_enable: true as const,
    }),
    delete: async (id: string) => omitUndefined({ deleted: await host.delete(id) }),
    enable: async (id: string, enabled: boolean) => omitUndefined({ routine: await host.enable(id, enabled) }),
    runNow: async (id: string) => {
      const launched = await host.runNow(id)
      const routine = 'routine' in launched && launched.routine !== undefined
        ? launched.routine
        : host.require?.(id)
      return omitUndefined({
        ...launched.sessionId ? { sessionId: launched.sessionId } : {},
        ...routine ? { routine } : {},
      })
    },
  }
}
