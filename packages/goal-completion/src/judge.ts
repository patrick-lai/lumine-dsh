/**
 * Isolated read-only judge. CI / tests use a fake. Runtime calls
 * `ctx.subagents.start(name, { prompt: ContentBlock[], parent, signal, toolFilter? })`
 * — the published `@deepseek-ai/dsh-subagent` shape. Pick a provider that is
 * actually registered (`list()` / a real `getProvider().start`). Grok-build
 * hosts typically have spawn / spawn-in-process / fork, not a nestable `acp`
 * child. Missing `start()` fail-closes UNVERIFIABLE. Generation never goes
 * through a fabricated DeepSeek key.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CompletionCandidate, JudgeFn, ResolvedConfig, Verdict } from './config.ts'
import { DEFAULT_START_TIMEOUT_MS } from './config.ts'
import { VERDICT_MARKER, parseJudgeOutput } from './markers.ts'

export const CI_FAKE_REASON = 'CI fake judge does not certify'

/** Process providers first. `acp` is last: grok-build list() usually has spawn, not acp. */
const PREFERRED_START_PROVIDERS = ['spawn', 'spawn-in-process', 'fork', 'acp'] as const

export const START_DID_NOT_SETTLE = 'subagents.start did not settle'
export const JUDGE_REASON_MAX = 240

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
  try {
    const llm = ctx.llm
    if (!llm?.listProviders) return []
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
  try {
    const tools = ctx.tools
    if (!tools?.schemas) return []
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

function listedProviders(subagents: NonNullable<Context['subagents']>): string[] {
  if (typeof subagents.list !== 'function') return []
  const names = subagents.list()
  return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string' && name.length > 0) : []
}

/** A stub `getProvider('acp')` (truthy, no `start`) is not a registered provider. */
export function isLiveStartProvider(subagents: NonNullable<Context['subagents']>, name: string): boolean {
  const names = listedProviders(subagents)
  if (names.includes(name)) return true
  if (names.length > 0) return false
  const provider = subagents.getProvider?.(name)
  return Boolean(provider && typeof (provider as { start?: unknown }).start === 'function')
}

/**
 * Prefer a process provider that `list()` actually has. Do not prefer `acp`
 * on a lumine ACP / grok-build parent — that session is the worker, not an
 * `acp` subagent provider. Empty `list()` plus a stub `getProvider('acp')`
 * must not call `start('acp')`.
 */
export function pickStartProvider(
  subagents: NonNullable<Context['subagents']>,
  _worker?: { session?: { header?: { agentPreset?: string }; events?: ReadonlyArray<{ type: string; data?: unknown }> } },
): string | undefined {
  const names = listedProviders(subagents)
  for (const name of PREFERRED_START_PROVIDERS) {
    if (isLiveStartProvider(subagents, name)) return name
  }
  return names[0]
}

export function truncateJudgeReason(message: string): string {
  const collapsed = message.replace(/\s+/g, ' ').trim()
  if (!collapsed) return 'the isolated judge threw'
  if (collapsed.length <= JUDGE_REASON_MAX) return collapsed
  return `${collapsed.slice(0, JUDGE_REASON_MAX)}…`
}

export function formatCaughtError(error: unknown): string {
  if (error instanceof Error && error.message) return truncateJudgeReason(error.message)
  return truncateJudgeReason(String(error))
}

type JudgeRunResult = {
  output?: Array<{ type?: string; text?: string }>
  text?: string
  stopReason?: string
  diagnostic?: string
}

function judgeTextFromResult(result: JudgeRunResult): string {
  const fromBlocks = contentBlocksToText(result.output)
  if (fromBlocks) return fromBlocks
  return typeof result.text === 'string' ? result.text : ''
}

/** Published `run.result` is `Promise<SubagentResult>` (`output`, `stopReason`, optional `diagnostic`). */
async function awaitPublishedResult(run: { result?: unknown }): Promise<JudgeRunResult> {
  if (run.result == null) throw new Error('subagent run.result is missing')
  return await run.result as JudgeRunResult
}

/** Race a start()/result promise against abort + a wall-clock watchdog. */
export function raceStart<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
  hungReason = START_DID_NOT_SETTLE,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error(signal.reason === 'timeout' ? 'judge timed out' : 'verification was cancelled'))
      return
    }
    const timer = setTimeout(() => {
      reject(new Error(hungReason))
    }, timeoutMs)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error(signal.reason === 'timeout' ? 'judge timed out' : 'verification was cancelled'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/**
 * Runtime judge. Never fabricates a DeepSeek credential and never calls a
 * DeepSeek adapter just to have a model. Missing `start()` → UNVERIFIABLE.
 */
function readSubagents(scope: { subagents?: Context['subagents']; get?: (name: string) => unknown } | undefined): Context['subagents'] {
  if (!scope) return undefined
  try {
    if (scope.subagents) return scope.subagents
  } catch {
    // Cordis: `cannot get property "subagents" without inject`
  }
  try {
    return scope.get?.('subagents') as Context['subagents']
  } catch {
    return undefined
  }
}

function resolveSubagents(ctx: Context, parent?: Agent): Context['subagents'] {
  return readSubagents(parent?.ctx) ?? readSubagents(ctx)
}

export function createRuntimeJudge(ctx: Context, config: ResolvedConfig, worker?: { options?: { provider?: string }; session?: { header?: { agentPreset?: string } } }): JudgeFn {
  if (config.judge) return config.judge
  if (config.fakeJudge) return fakeJudge()

  return async (candidate, signal) => {
    if (signal.aborted) return { decision: 'UNVERIFIABLE', reason: 'verification was cancelled' }

    const parent = candidate.parent ?? (worker as Agent | undefined)
    const subagents = resolveSubagents(ctx, parent)
    if (!subagents || typeof subagents.start !== 'function') {
      ctx.logger.warn('lumine-goal-completion: subagents.start is missing; judge is UNVERIFIABLE')
      return { decision: 'UNVERIFIABLE', reason: 'no read-only judge is available' }
    }
    if (!parent) {
      return { decision: 'UNVERIFIABLE', reason: 'no parent agent for the isolated judge' }
    }

    const providerName = pickStartProvider(subagents, parent)
    if (!providerName) {
      ctx.logger.warn('lumine-goal-completion: no subagent provider is registered; judge is UNVERIFIABLE')
      return { decision: 'UNVERIFIABLE', reason: 'no subagent provider is registered' }
    }
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
    if (provider?.capabilities?.toolFilter === true) request.toolFilter = toolFilter
    if (chosen && provider?.capabilities?.agentOptions === true) request.agentOptions = { provider: chosen }

    const startTimeoutMs = config.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
    let run: Awaited<ReturnType<NonNullable<NonNullable<Context['subagents']>['start']>>> | undefined
    try {
      ctx.logger.info(`lumine-goal-completion: starting judge via subagents.start(${providerName})`)
      run = await raceStart(subagents.start(providerName, request), signal, startTimeoutMs)
      const result = await raceStart(awaitPublishedResult(run), signal, config.timeoutMs, 'the isolated judge did not finish')
      if (result.stopReason === 'error') {
        const diagnostic = typeof result.diagnostic === 'string' && result.diagnostic.trim()
          ? truncateJudgeReason(result.diagnostic)
          : 'the isolated judge stopped: error'
        return { decision: 'UNVERIFIABLE', reason: diagnostic }
      }
      if (result.stopReason && result.stopReason !== 'completed') {
        return { decision: 'UNVERIFIABLE', reason: `the isolated judge stopped: ${result.stopReason}` }
      }
      return foldJudgeText(judgeTextFromResult(result))
    } catch (error: unknown) {
      if (signal.aborted) return { decision: 'UNVERIFIABLE', reason: 'verification was cancelled' }
      const message = formatCaughtError(error)
      ctx.logger.warn(`lumine-goal-completion: judge subagent failed: ${message}`)
      if (message === START_DID_NOT_SETTLE) return { decision: 'UNVERIFIABLE', reason: START_DID_NOT_SETTLE }
      return { decision: 'UNVERIFIABLE', reason: message }
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
