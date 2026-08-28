/**
 * Host-owned durable routines for DeepSeek Harness.
 *
 * Sits beside `@deepseek-ai/dsh-schedule` (session-local reminders) and
 * beside `@lumine/dsh-acp-session`. Never stored in the session event log.
 *
 * Loaded via `src/index.ts` after DSH peers are linked. Do not import this
 * file from the package `main` until `ensureDshPeers()` has run.
 *
 * @module @lumine/dsh-routines
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolveConfig, type Config } from './config.ts'
import { RoutineService } from './service.ts'

export const name = 'lumine-routines'
export const inject = ['agents']

export type { Config } from './config.ts'
export { resolveConfig } from './config.ts'
export { RoutineService } from './service.ts'
export { RoutineStore } from './store.ts'
export { filePersist, openPersist } from './persist.ts'
export {
  cronNext,
  isActiveRunBlocking,
  missedFireCount,
  nextRun,
  parseCron,
  shouldFire,
  windowContains,
} from './calendar.ts'
export { parseRoutineCommand } from './command.ts'
export { ensureDshPeers, DSH_PEERS } from './peers.ts'
export { RoutineError } from './types.ts'
export type { CreateRoutineInput, Routine, RoutineRule, UpdateRoutineInput } from './types.ts'

export function apply(ctx: Context, config: Config = {}): void {
  ctx.plugin(RoutineService, resolveConfig(config))
}

export default {
  name,
  inject,
  apply,
}
