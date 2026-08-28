/**
 * Isolated read-only judge. CI / tests use a fake. Runtime calls
 * `ctx.subagents.start(name, { prompt: ContentBlock[], parent, signal, toolFilter? })`
 * — the published `@deepseek-ai/dsh-subagent` shape. Prefer a provider with
 * `toolFilter` and a different LLM product than the worker when available.
 * Missing `start()` fail-closes UNVERIFIABLE. Generation never goes through
 * a fabricated DeepSeek key.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CompletionCandidate, JudgeFn, ResolvedConfig, Verdict } from './config.ts'
import { VERDICT_MARKER, parseJudgeOutput } from './markers.ts'

export const CI_FAKE_REASON = 'CI fake judge does not certify'

const PREFERRED_START_PROVIDERS = ['spawn', 'fork', 'spawn-in-process'] as const

const WRITE_TOOL_NAMES = new Set([
  'bash',
  'pwsh',
  'write',
  'edit',
  'apply_patch',
  'delete',
  'create_goal',
  'update_goal',
  'subagent',
  'subagent_fork',
  'subagent_codex',
  'subagent_claude_code',
  'subagent_claude-code',
])

export function fakeJudge(decision: Verdict['decision'] = 'UNVERIFIABLE', reason = CI_FAKE_REASON): JudgeFn {
  return async () => ({ decision, reason })
}

export function judgePrompt(candidate: CompletionCandidate): string {
  return [
    'You are a fresh, independent completion verifier. The worker claimed a host-owned goal is',
    'complete. Judge the ORIGINAL objective against authoritative CURRENT evidence. You are a',
    'read-only reader: inspect the checkout when repository evidence is relevant, but do not edit',
    'files, run mutating commands, contact people, or trust the claim merely because the worker',
    'printed it.',
    '',
    'Approve only when every material requirement is proven. Reject when current evidence shows',
    'the objective is incomplete or contradicted. Return unverifiable when required evidence is',
    'missing, inaccessible, ambiguous, or would require a prohibited mutation.',
    '',
    'ORIGINAL OBJECTIVE:',
    '<objective>',
    candidate.objective,
    '</objective>',
    '',
    "WORKER'S FINAL REPLY:",
    '<final-reply>',
    candidate.reply,
    '</final-reply>',
    '',
    `End with exactly one line beginning with ${VERDICT_MARKER}, followed by`,
    'exactly one decision word (APPROVED, REJECTED, or UNVERIFIABLE), " - ", and one concise',
    'evidence-based reason. Write that verdict line nowhere else.',
  ].join('\n')
}

export function foldJudgeText(output: string | undefined): Verdict {
  if (!output) return { decision: 'UNVERIFIABLE', reason: 'the verifier returned no explicit verdict' }
  return parseJudgeOutput(output) ?? { decision: 'UNVERIFIABLE', reason: 'the verifier returned no explicit verdict' }
}

export function contentBlocksToText(blocks: ReadonlyArray<{ type?: string; text?: string }> | undefined): string {
  if (!blocks) return ''
  return blocks
    .filter(block => (block.type === 'text' || block.type === undefined) && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}

function workerProduct(agent: { options?: { provider?: string }; session?: { header?: { agentPreset?: string } } } | undefined): string | undefined {
  const provider = agent?.options?.provider?.trim().toLowerCase()
  if (provider) return provider
  const preset = agent?.session?.header?.agentPreset?.trim().toLowerCase()
  return preset || undefined
}

function availableProducts(ctx: Context): string[] {
  const llm = ctx.llm
  if (!llm?.listProviders) return []
  try {
    return llm.listProviders().map(entry => entry.id).filter(id => id && id !== 'deepseek' && id !== 'deepseek-official')
  } catch {
    return []
  }
}

function preferDifferentProduct(worker: string | undefined, available: readonly string[], preferred?: string): string | undefined {
  if (preferred && available.includes(preferred) && preferred !== worker) return preferred
  if (preferred && available.includes(preferred)) return preferred
  const independent = available.find(id => id !== worker)
  return independent ?? available[0]
}

function isWriteTool(name: string): boolean {
  const lowered = name.toLowerCase()
  if (WRITE_TOOL_NAMES.has(lowered)) return true
  return lowered.includes('write') || lowered.includes('edit') || lowered === 'bash' || lowered === 'pwsh'
}

function listToolNames(ctx: Context): string[] {
  const tools = ctx.tools
  if (!tools?.schemas) return []
  try {
    return tools.schemas().map(entry => entry.name).filter((name): name is string => typeof name === 'string' && name.length > 0)
  } catch {
    return []
  }
}

/** Strip write tools. Unknown names fail `start`, so only deny registered names. */
export function judgeToolFilter(ctx: Context): { allow?: string[]; deny?: string[] } {
  const names = listToolNames(ctx)
  if (names.length === 0) return { allow: [] }
  const deny = names.filter(isWriteTool)
  if (deny.length > 0) return { deny }
  return { allow: [] }
}

export function pickStartProvider(subagents: NonNullable<Context['subagents']>): string | undefined {
  const names = typeof subagents.list === 'function' ? subagents.list() : []
  const available = new Set(names)
  const supportsFilter = (name: string): boolean | undefined => {
    const provider = subagents.getProvider?.(name)
    return provider?.capabilities?.toolFilter
  }
  for (const name of PREFERRED_START_PROVIDERS) {
    if (!available.has(name) && names.length > 0) continue
    if (names.length === 0 && !subagents.getProvider?.(name)) continue
    if (supportsFilter(name) !== false) return name
  }
  for (const name of names) {
    if (supportsFilter(name)) return name
  }
  return names[0]
}

/**
 * Runtime judge. Never fabricates a DeepSeek credential and never calls a
 * DeepSeek adapter just to have a model. Missing `start()` → UNVERIFIABLE.
 */
export function createRuntimeJudge(ctx: Context, config: ResolvedConfig, worker?: { options?: { provider?: string }; session?: { header?: { agentPreset?: string } } }): JudgeFn {
  if (config.judge) return config.judge
  if (config.fakeJudge) return fakeJudge()

  return async (candidate, signal) => {
    if (signal.aborted) return { decision: 'UNVERIFIABLE', reason: 'verification was cancelled' }

    const parent = candidate.parent ?? (worker as Agent | undefined)
    const subagents = ctx.subagents
    if (!subagents || typeof subagents.start !== 'function') {
      return { decision: 'UNVERIFIABLE', reason: 'no read-only judge is available' }
    }
    if (!parent) {
      return { decision: 'UNVERIFIABLE', reason: 'no parent agent for the isolated judge' }
    }

    const providerName = pickStartProvider(subagents) ?? 'spawn'
    const provider = subagents.getProvider?.(providerName)
    const products = availableProducts(ctx)
    const chosen = preferDifferentProduct(workerProduct(parent) ?? workerProduct(worker ?? {}), products, config.judgePreset)
    const toolFilter = judgeToolFilter(ctx)
    const request: {
      prompt: Array<{ type: 'text'; text: string }>
      parent: Agent
      signal: AbortSignal
      toolFilter?: { allow?: string[]; deny?: string[] }
      agentOptions?: { provider: string }
    } = {
      prompt: [{ type: 'text', text: judgePrompt(candidate) }],
      parent,
      signal,
    }
    if (provider?.capabilities?.toolFilter !== false) request.toolFilter = toolFilter
    if (chosen && provider?.capabilities?.agentOptions) request.agentOptions = { provider: chosen }

    let run: Awaited<ReturnType<NonNullable<NonNullable<Context['subagents']>['start']>>> | undefined
    try {
      run = await subagents.start(providerName, request)
      const result = await run.result
      if (result.stopReason && result.stopReason !== 'completed') {
        return { decision: 'UNVERIFIABLE', reason: `the isolated judge stopped: ${result.stopReason}` }
      }
      return foldJudgeText(contentBlocksToText(result.output))
    } catch (error: unknown) {
      if (signal.aborted) return { decision: 'UNVERIFIABLE', reason: 'verification was cancelled' }
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.warn(`lumine-goal-completion: judge subagent failed: ${message}`)
      return { decision: 'UNVERIFIABLE', reason: 'the isolated judge did not finish' }
    } finally {
      try {
        await run?.dispose()
      } catch {
        // Disposal is best-effort; the verdict already fail-closed if needed.
      }
    }
  }
}

export function resolveJudge(ctx: Context, config: ResolvedConfig, worker?: { options?: { provider?: string }; session?: { header?: { agentPreset?: string } } }): JudgeFn {
  return createRuntimeJudge(ctx, config, worker)
}
