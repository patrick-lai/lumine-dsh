/**
 * ACP session factory for DeepSeek Harness.
 *
 * Replaces `@deepseek-ai/dsh-agent-loop` so a Web session IS Claude Code,
 * Codex, Cursor, or Grok Build. The official product process owns tools;
 * DSH owns the append-only session log the Web UI reads.
 *
 * Loaded via `src/index.ts` after DSH peers are linked. Do not import this
 * file from the package `main` until `ensureDshPeers()` has run.
 *
 * @module @lumine/dsh-acp-session
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolveConfig, type Config } from './config.ts'
import { LumineAcpFactory } from './factory.ts'
import { installPickerPresets } from './presets.ts'

export const name = 'lumine-acp-session'
export const inject = ['agents', 'sessions', 'llm']

export type { Config, PermissionMode, ProviderOverride } from './config.ts'
export { resolveConfig } from './config.ts'
export {
  MissingCliError,
  PRESET_TO_PROVIDER,
  PROVIDER_IDS,
  resolveLaunch,
  resolveProviderId,
  whichOnPath,
} from './providers.ts'
export type { ProviderId, ResolvedLaunch } from './providers.ts'
export { TurnProjector, lastBoundAcpSession, userMessageText } from './events.ts'
export {
  describeError,
  driverErrorRecord,
  formatDriverFailure,
  isJsonSafe,
  nextTurnOf,
  openTurnThenClaim,
} from './turn.ts'
export {
  AcpCatalogAdapter,
  AcpCatalogRegistry,
  configIdForModel,
  configIdForReasoning,
  fallbackCatalog,
  grokSeedCatalog,
  hostSelectionCurrent,
  lastModelSelection,
  pickerSnapshot,
  projectAcpModels,
  seedSessionRoute,
  selectionFromCatalog,
} from './models.ts'
export type { CatalogModel, HostModelSelection, ProjectedCatalog } from './models.ts'
export { ensureDshPeers, DSH_PEERS } from './peers.ts'

export function apply(ctx: Context, config: Config = {}): void {
  try {
    installPickerPresets()
  } catch (error: unknown) {
    ctx.logger.warn(
      `lumine-acp-session: could not install picker presets: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const resolved = resolveConfig(config)
  ctx.plugin(LumineAcpFactory, resolved)
}

export default {
  name,
  inject,
  apply,
}
