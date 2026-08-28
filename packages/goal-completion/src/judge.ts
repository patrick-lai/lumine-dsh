/**
 * Isolated read-only judge. CI / tests use a fake. Runtime prefers a DSH
 * subagent or a second agent with write tools stripped, and a different
 * product than the worker when one is available. Generation never goes
 * through a fabricated DeepSeek key.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CompletionCandidate, JudgeFn, ResolvedConfig, Verdict } from './config.ts'
import { VERDICT_MARKER, parseJudgeOutput } from './markers.ts'

export const CI_FAKE_REASON = 'CI fake judge does not certify'

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

function workerProduct(agent: { options?: { provider?: string }; session?: { header?: { agentPreset?: string } } }): string | undefined {
  const provider = agent.options?.provider?.trim().toLowerCase()
  if (provider) return provider
  const preset = agent.session?.header?.agentPreset?.trim().toLowerCase()
  return preset || undefined
}

function availableProducts(ctx: Context): string[] {
  const llm = (ctx as Context & { llm?: { listProviders?: () => Array<{ id: string }> } }).llm
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

/**
 * Runtime judge. Never writes `DEEPSEEK_API_KEY` and never calls a DeepSeek
 * adapter just to have a model. Missing judge → UNVERIFIABLE.
 */
export function createRuntimeJudge(ctx: Context, config: ResolvedConfig, worker?: { options?: { provider?: string }; session?: { header?: { agentPreset?: string } } }): JudgeFn {
  if (config.judge) return config.judge
  if (config.fakeJudge) return fakeJudge()

  return async (candidate, signal) => {
    if (signal.aborted) return { decision: 'UNVERIFIABLE', reason: 'verification was cancelled' }

    const subagents = ctx.subagents
    const products = availableProducts(ctx)
    const chosen = preferDifferentProduct(workerProduct(worker ?? {}), products, config.judgePreset)
    const prompt = judgePrompt(candidate)

    if (subagents && (typeof subagents.run === 'function' || typeof subagents.spawn === 'function')) {
      const run = subagents.run ?? subagents.spawn
      try {
        const result = await run!.call(subagents, {
          prompt,
          readOnly: true,
          stripWriteTools: true,
          ...chosen === undefined ? {} : { provider: chosen, preset: config.judgePreset ?? chosen },
          signal,
        })
        const text = typeof result?.text === 'string' ? result.text : typeof result?.output === 'string' ? result.output : ''
        return foldJudgeText(text)
      } catch (error: unknown) {
        if (signal.aborted) return { decision: 'UNVERIFIABLE', reason: 'verification was cancelled' }
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger.warn(`lumine-goal-completion: judge subagent failed: ${message}`)
        return { decision: 'UNVERIFIABLE', reason: 'the isolated judge did not finish' }
      }
    }

    return { decision: 'UNVERIFIABLE', reason: 'no read-only judge is available' }
  }
}

export function resolveJudge(ctx: Context, config: ResolvedConfig, worker?: { options?: { provider?: string }; session?: { header?: { agentPreset?: string } } }): JudgeFn {
  return createRuntimeJudge(ctx, config, worker)
}
