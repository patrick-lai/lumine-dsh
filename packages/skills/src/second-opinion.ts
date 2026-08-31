/**
 * Host-plane second opinion: spawn a cheap read-only subagent when the host
 * actually has `subagents.start`. ACP children usually do not — then the
 * slash command followup is the whole pass (the child uses its own Task tool).
 */

export interface SubagentsLike {
  start?: (name: string, options: Record<string, unknown>) => Promise<{ result?: Promise<unknown> } | unknown>
  list?: () => string[]
}

export const SECOND_OPINION_FRAME = '<<<SECOND_OPINION'

export function secondOpinionPrompt(brief: string): string {
  return [
    'You are a cheap, read-only native reviewer. Do not edit files.',
    'Return at most five findings. Empty findings means nothing to do.',
    `End with a line that is exactly ${SECOND_OPINION_FRAME} then JSON {"findings":[{"severity":"concern"|"blocker","path":"...","note":"..."}]}`,
    '',
    brief,
  ].join('\n')
}

export function formatSecondOpinionResult(output: string): string {
  const trimmed = output.trim()
  if (!trimmed) return 'SECOND OPINION · FAILED (empty reviewer reply)'
  const index = trimmed.lastIndexOf(SECOND_OPINION_FRAME)
  const jsonText = index >= 0 ? trimmed.slice(index + SECOND_OPINION_FRAME.length).trim() : trimmed
  try {
    const parsed = JSON.parse(jsonText) as { findings?: unknown }
    const findings = Array.isArray(parsed.findings) ? parsed.findings : []
    if (findings.length === 0) return 'SECOND OPINION · NONE'
    return `SECOND OPINION · ${findings.length} findings\n${trimmed.slice(0, 4000)}`
  } catch {
    return `SECOND OPINION · ${trimmed.slice(0, 4000)}`
  }
}

function listed(subagents: SubagentsLike): string[] {
  if (typeof subagents.list !== 'function') return []
  const names = subagents.list()
  return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : []
}

export async function tryHostSecondOpinion(
  subagents: SubagentsLike | undefined,
  brief: string,
  parent: unknown,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!subagents || typeof subagents.start !== 'function') return undefined
  const names = listed(subagents)
  const provider = ['spawn-in-process', 'spawn', 'fork'].find(name => names.includes(name)) ?? names[0]
  if (!provider) return undefined
  try {
    const run = await subagents.start(provider, {
      prompt: [{ type: 'text', text: secondOpinionPrompt(brief) }],
      parent,
      signal,
      toolFilter: { allow: [] },
    }) as { result?: Promise<{ text?: string; output?: Array<{ text?: string }> }> }
    const result = run && typeof run === 'object' && 'result' in run ? await run.result : undefined
    const blocks = result?.output
    const text = typeof result?.text === 'string'
      ? result.text
      : Array.isArray(blocks)
        ? blocks.map(block => block.text).filter(Boolean).join('\n')
        : ''
    return formatSecondOpinionResult(text)
  } catch {
    return undefined
  }
}
