import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { renderTemplate } from './calendar.ts'
import type { ResolvedConfig } from './config.ts'
import type { Routine } from './types.ts'

export interface DeliveryResult {
  readonly sessionId?: string
  readonly note?: string
  readonly usedFallback?: boolean
}

function asSessionId(id: string): SessionId {
  return id as SessionId
}

function userMessage(text: string): import('@deepseek-ai/dsh-llm').UserMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

async function makeUserMessage(text: string): Promise<import('@deepseek-ai/dsh-llm').UserMessage> {
  try {
    const llm = await import('@deepseek-ai/dsh-llm')
    if (typeof llm.createUserMessage === 'function') {
      return llm.createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      })
    }
  } catch {
    // Official host without the helper still accepts a well-shaped user message.
  }
  return userMessage(text)
}

function resolveWorkspace(ctx: Context, config: ResolvedConfig, routine: Routine): string | undefined {
  const named = routine.workspaceCwd?.trim() || config.defaultWorkspaceCwd?.trim()
  if (named) return named
  const registry = ctx.get<{ default?: { path?: string; cwd?: string }; list?: () => Array<{ path?: string; cwd?: string }> }>('workspaceRegistry')
  const fallback = registry?.default?.path ?? registry?.default?.cwd ?? registry?.list?.()[0]?.path ?? registry?.list?.()[0]?.cwd
  return fallback?.trim() || undefined
}

function promptSession(agent: Agent, message: import('@deepseek-ai/dsh-llm').UserMessage): void {
  if (typeof agent.send === 'function') {
    agent.send(message, 'next-turn', true)
    return
  }
  if (typeof agent.followup === 'function') {
    agent.followup(message)
  }
}

function looksComplete(agent: Agent): boolean {
  const events = agent.session?.events ?? []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message' && event?.type !== 'assistant/chunk') continue
    const data = event.data as { text?: string; content?: Array<{ text?: string }> } | undefined
    const text = data?.text ?? data?.content?.map(block => block.text ?? '').join('') ?? ''
    if (/^\s*GOAL REACHED:/m.test(text) || /^\s*BLOCKED:/m.test(text)) return true
  }
  return false
}

/**
 * v1 grind: hidden continue loop with a ceiling. Board/swarm/gnhf/co-read
 * are intentionally absent. If a /goal certifier is mounted we still use
 * this continue loop — we do not drive ctx.goals.
 */
async function grindContinue(agent: Agent, routine: Routine, config: ResolvedConfig, signal: AbortSignal): Promise<string> {
  const ceiling = routine.grind?.maxIterations && routine.grind.maxIterations > 0
    ? routine.grind.maxIterations
    : config.grindMaxTurns
  let turns = 0
  while (turns < ceiling) {
    if (signal.aborted) return `grind aborted after ${turns} continue(s)`
    if (typeof agent.whenIdle === 'function') {
      await agent.whenIdle()
    }
    if (looksComplete(agent)) return `grind settled after ${turns} continue(s)`
    turns += 1
    if (turns > ceiling) break
    const message = await makeUserMessage(
      `PINNED ROUTINE — continue the objective (auto-continue ${turns}/${ceiling}). Do not wait for the operator.\n\n${routine.promptTemplate}`,
    )
    if (typeof agent.followup === 'function') agent.followup(message)
    else promptSession(agent, message)
  }
  return `grind v1 reached continue ceiling ${ceiling}`
}

export async function deliverRoutine(
  ctx: Context,
  config: ResolvedConfig,
  routine: Routine,
  extras: Record<string, string> = {},
  signal: AbortSignal,
): Promise<DeliveryResult> {
  const agents = ctx.agents ?? ctx.get<Context['agents']>('agents')
  if (!agents || typeof agents.create !== 'function') {
    throw new Error('DSH agents.create is unavailable; cannot spawn a routine session')
  }
  const cwd = resolveWorkspace(ctx, config, routine)
  const preset = routine.preset?.trim() || config.defaultPreset
  const prompt = renderTemplate(routine.promptTemplate, routine.parameters, {
    title: routine.title,
    mode: routine.mode,
    ...extras,
  })
  const handle: AgentHandle = await agents.create({
    sessionId: asSessionId(crypto.randomUUID()),
    meta: {
      ...cwd ? { cwd } : {},
      agentPreset: preset,
    },
    signal,
  })
  const sessionId = String(handle.agent.id)
  const message = await makeUserMessage(prompt)
  promptSession(handle.agent, message)
  let note = `spawned ${preset}${cwd ? ` in ${cwd}` : ''}`
  if (routine.mode === 'grind') {
    note = `${note}; grind v1 continue loop`
    note = `${note}; ${await grindContinue(handle.agent, routine, config, signal)}`
  }
  return { sessionId, note }
}
