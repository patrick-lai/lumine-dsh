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
import { LeylineChromeService, WorktreeChromeService } from './chrome-rpc.ts'
import { resolveConfig, type Config } from './config.ts'
import { LumineAcpFactory } from './factory.ts'
import { createLastModelsStore } from './last-models.ts'
import { mountAcpCatalog } from './models.ts'
import { installSessionPickerGate } from './picker-gate.ts'
import { installPickerPresets } from './presets.ts'

export const name = 'lumine-acp-session'
/**
 * Plugin-root inject. Must match `LumineAcpFactory.static inject` and
 * official `dsh-agent-loop`: nested inject is exclusive; `createScope`
 * inherits only the factory list.
 */
export const inject = ['agents', 'sessions', 'llm', 'tools', 'systemPrompt']

export type { Config, PermissionMode, ProviderOverride, WorktreeConfig, WorktreeMode } from './config.ts'
export { resolveConfig, resolveWorktrees } from './config.ts'
export {
  acquireWorktree,
  mapWorkspaceIntoTree,
  PARALLEL_CHECKOUT,
  releaseWorktree,
  resolveStartPoint,
  START_POINT_CANDIDATES,
} from './worktree.ts'
export { classifyReclaim, isClaimable } from './worktree-reclaim.ts'
export {
  detectAtlassian,
  isPooledWorktreePath,
  poolRoot,
  repoName,
  sha6,
  slug,
  WORKTREES_LEAF,
} from './worktree-pool.ts'
export {
  MissingCliError,
  PRESET_TO_PROVIDER,
  PROVIDER_IDS,
  lastSelectedAgentPreset,
  providerFromSession,
  resolveLaunch,
  resolveProviderId,
  whichOnPath,
} from './providers.ts'
export type { ProviderId, ResolvedLaunch } from './providers.ts'
export { TurnProjector, lastBoundAcpSession, lastBoundWorktree, userMessageText } from './events.ts'
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
  adoptPickerCurrent,
  catalogRoute,
  claudeSeedCatalog,
  configIdForModel,
  configIdForReasoning,
  constrainSessionCatalog,
  cursorSeedCatalog,
  fallbackCatalog,
  grokSeedCatalog,
  hostSelectionCurrent,
  hostServesProvider,
  hostSessionModels,
  lastModelSelection,
  mountAcpCatalog,
  pickerSnapshot,
  projectAcpModels,
  seedSessionRoute,
  selectionForAgent,
  selectionFromCatalog,
  selectionSupportedByAgent,
} from './models.ts'
export type { CatalogModel, HostModelSelection, ProjectedCatalog } from './models.ts'
export {
  gateApiProxySessions,
  installSessionPickerGate,
  providerOfPickerSession,
} from './picker-gate.ts'
export { LastModelsStore, createLastModelsStore, lastModelsPath, parseLastModels } from './last-models.ts'
export { leylineMcpServers, LEYLINE_MCP_NAME, LEYLINE_MCP_ARGS } from './mcp.ts'
export {
  LeylineChromeService,
  WorktreeChromeService,
  boundWorktree,
  leylineStatus,
  listWorktrees,
} from './chrome-rpc.ts'
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
  // Register on the host llm from apply — not the factory constructor —
  // so listProviders() already contains grok before session.create.
  const catalog = mountAcpCatalog(ctx)
  const lastModels = createLastModelsStore()
  installSessionPickerGate(ctx as never, catalog, lastModels)
  ctx.plugin(LumineAcpFactory, { ...resolved, catalog, lastModels })
  ctx.plugin(WorktreeChromeService)
  ctx.plugin(LeylineChromeService)
}

export default {
  name,
  inject,
  apply,
}
