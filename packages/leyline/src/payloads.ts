/**
 * Leyline host-adapter payload builders. Wire shapes are pinned by golden
 * fixtures. Additive-only: every required nullable key is present as null.
 */

import { CLIENT_VERSION, SOURCE_CLIENT_ID } from './config.ts'
import { oneLine, prefix, scrubSecrets, suffix } from './scrub.ts'

export const SESSION_EVENTS_SCHEMA = 'leyline.session_events.write.v1'
export const LIFECYCLE_SCHEMA = 'leyline.lifecycle.v1'
export const MATERIALIZE_SCHEMA = 'leyline.materialize.v1'
export const MAX_SCROLLBACK_CHARS = 6000
export const MAX_TOOL_EVENTS = 200
export const MAX_TOOL_PREVIEW_CHARS = 4096

export type ReceiptResult = 'success' | 'failed'

export interface ContextPackBudget {
  max_memories: number
  max_tokens: number
}

export interface ContextPackScope {
  workspace_id: string
  repo_id: string | null
}

export interface ContextPackRequest {
  query: string
  scope: ContextPackScope
  budget: ContextPackBudget
}

export interface ContextPackMemory {
  id?: string
  title?: string
  score?: number
  lane?: string
  snippet?: string
  source?: string
}

export interface ContextPackResponse {
  memories?: ContextPackMemory[]
  cards?: unknown[]
  recall_id?: string
}

export interface CompiledRecall {
  text: string
  recallIds: string[]
  memoryIds: string[]
}

export interface ToolOutcome {
  toolName: string
  succeeded: boolean
  argPreview?: string
  resultPreview?: string
}

export interface SessionReceipt {
  result: ReceiptResult
  label: string
  recall_ids: string[]
  diff_stat?: string
  files?: string[]
}

export interface SessionEventsInput {
  sourceSessionId: string
  workspaceId: string
  workspacePath?: string
  repoId?: string
  title?: string
  startedAt?: string
  settledAt: string
  digest: string
  tail?: string
  durationSeconds?: number
  agent?: string
  receipt: SessionReceipt
  toolOutcomes?: ToolOutcome[]
}

export type LifecycleKind = 'workspace_removed' | 'worktree_deleted' | 'branch_merged' | 'repo_archived'

export interface LifecycleEvent {
  schema_version: string
  source_client_id: string
  kind: LifecycleKind
  workspace_id: string
  repo_id: string | null
  branch: string | null
  worktree_path: string | null
}

export interface MaterializeRequest {
  schema_version: string
  path: string
  workspace_id: string
  repo_id: string | null
  max_memories: number
}

export function settleIdempotencyKey(sessionId: string): string {
  return `lumine-dsh-settle-${sessionId}`
}

export function buildContextPackRequest(input: {
  query: string
  workspaceId: string
  repoId?: string
  maxMemories: number
  maxTokens: number
}): ContextPackRequest {
  return {
    query: input.query,
    scope: {
      workspace_id: input.workspaceId,
      repo_id: input.repoId ?? null,
    },
    budget: {
      max_memories: input.maxMemories,
      max_tokens: input.maxTokens,
    },
  }
}

export function compileRecall(pack: ContextPackResponse | undefined): CompiledRecall {
  const memories = Array.isArray(pack?.memories) ? pack.memories : []
  const memoryIds = memories
    .map(memory => typeof memory.id === 'string' ? memory.id : undefined)
    .filter((id): id is string => Boolean(id))
  const recallIds = typeof pack?.recall_id === 'string' && pack.recall_id
    ? [pack.recall_id]
    : []
  const lines = memories.map((memory) => {
    const title = oneLine(memory.title ?? memory.id ?? 'memory')
    const snippet = oneLine(memory.snippet ?? '')
    const score = typeof memory.score === 'number' ? ` (${memory.score.toFixed(2)})` : ''
    return snippet ? `- ${title}${score}: ${snippet}` : `- ${title}${score}`
  })
  const text = lines.length === 0
    ? ''
    : ['Leyline recall (host context; not a user message):', ...lines].join('\n')
  return { text, recallIds, memoryIds }
}

export function buildSessionEventsPayload(input: SessionEventsInput): Record<string, unknown> {
  let digest = scrubSecrets(input.digest)
  if (input.tail) {
    const bounded = suffix(scrubSecrets(input.tail), MAX_SCROLLBACK_CHARS)
    digest += `\n\n----- TERMINAL TAIL (scrubbed) -----\n${bounded}`
  }
  const tools = (input.toolOutcomes ?? []).slice(0, MAX_TOOL_EVENTS)
  const toolEvents = tools.map((tool, index) => ({
    id: `lumine-dsh-tool-${input.sourceSessionId}-${index}`,
    related_message_id: null,
    tool_name: tool.toolName,
    status: tool.succeeded ? 'succeeded' : 'failed',
    arg_preview: prefix(scrubSecrets(tool.argPreview ?? ''), MAX_TOOL_PREVIEW_CHARS),
    result_preview: prefix(scrubSecrets(tool.resultPreview ?? ''), MAX_TOOL_PREVIEW_CHARS),
  }))
  const metadata: Record<string, unknown> = { result: input.receipt.result }
  if (input.durationSeconds !== undefined) metadata.duration_seconds = input.durationSeconds
  if (input.agent) metadata.agent = input.agent

  const receipt: Record<string, unknown> = {
    result: input.receipt.result,
    label: input.receipt.label,
    recall_ids: input.receipt.recall_ids,
  }
  if (input.receipt.diff_stat) receipt.diff_stat = oneLine(scrubSecrets(input.receipt.diff_stat))
  if (input.receipt.files?.length) receipt.files = input.receipt.files.slice(0, 20)
  if (tools.length > 0) {
    receipt.tool_calls = tools.length
    receipt.tool_failures = tools.filter(tool => !tool.succeeded).length
  }

  return {
    schema_version: SESSION_EVENTS_SCHEMA,
    source_client: {
      client_id: SOURCE_CLIENT_ID,
      client_version: CLIENT_VERSION,
      host_instance_id: null,
    },
    scope: {
      team_id: null,
      workspace_id: input.workspaceId,
      workspace_path: input.workspacePath ?? null,
      repo_id: input.repoId ?? null,
      repo_fingerprint: null,
    },
    session: {
      source_session_id: input.sourceSessionId,
      agent_session_id: null,
      title: input.title ?? null,
      started_at: input.startedAt ?? null,
      updated_at: input.settledAt,
      deep_link: null,
    },
    events: [{
      idempotency_key: settleIdempotencyKey(input.sourceSessionId),
      timestamp: input.settledAt,
      peer_id: 'lumine-dsh:harness',
      role: 'system',
      content: [{ type: 'text', text: digest }],
      tool_events: toolEvents,
      source_ref: null,
      metadata,
    }],
    privacy: {
      raw_retention: 'local_only',
      hosted_sync: 'distilled_only',
      redaction_profile: 'default',
      max_tool_preview_chars: MAX_TOOL_PREVIEW_CHARS,
    },
    extensions: {
      'lumine-dsh': { adapter: 1, receipt },
    },
  }
}

export function buildLifecycleEvent(input: {
  kind: LifecycleKind
  workspaceId: string
  repoId?: string
  branch?: string
  worktreePath?: string
}): LifecycleEvent {
  return {
    schema_version: LIFECYCLE_SCHEMA,
    source_client_id: SOURCE_CLIENT_ID,
    kind: input.kind,
    workspace_id: input.workspaceId,
    repo_id: input.repoId ?? null,
    branch: input.branch ?? null,
    worktree_path: input.worktreePath ?? null,
  }
}

export function buildMaterializeRequest(input: {
  path: string
  workspaceId: string
  repoId?: string
  maxMemories?: number
}): MaterializeRequest {
  return {
    schema_version: MATERIALIZE_SCHEMA,
    path: input.path,
    workspace_id: input.workspaceId,
    repo_id: input.repoId ?? null,
    max_memories: input.maxMemories ?? 12,
  }
}
