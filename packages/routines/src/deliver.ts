import { renderTemplate } from './calendar.ts'
import type { Routine } from './types.ts'

function randomId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export interface AgentLike {
  id?: string
  sessionId?: string
  session?: SessionLike
  send?: (...args: unknown[]) => unknown
}

export interface AgentHandleLike {
  agent?: AgentLike
  dispose?: () => Promise<void> | void
}

export interface AgentsApi {
  create: (opts?: Record<string, unknown>) => Promise<AgentHandleLike | AgentLike>
}

export interface SessionLike {
  id?: string
  append?: (type: string, data: unknown) => Promise<unknown> | unknown
}

export interface SessionsApi {
  get?: (id: string) => Promise<SessionLike | undefined> | SessionLike | undefined
}

export interface DeliverContext {
  agents?: AgentsApi
  sessions?: SessionsApi
  cwd?: string
  defaultPreset?: string
}

export interface DeliveryResult {
  ok: boolean
  sessionId?: string
  note?: string
}

export function renderRoutinePrompt(routine: Routine, now: number = Date.now()): string {
  return renderTemplate(routine.promptTemplate, routine.parameters, {
    SCHEDULE_ID: routine.id,
    SCHEDULE_TITLE: routine.title,
    NOW_ISO: new Date(now).toISOString(),
  })
}

export function userMessageText(message: unknown): string {
  if (typeof message === 'string') return message
  if (typeof message !== 'object' || message === null) return ''
  const record = message as { text?: unknown; content?: unknown }
  if (typeof record.text === 'string') return record.text
  if (!Array.isArray(record.content)) return ''
  return record.content
    .map(part => (typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string'
      ? (part as { text: string }).text
      : ''))
    .join('')
}

function unwrapAgent(created: AgentHandleLike | AgentLike): AgentLike {
  if (created && typeof created === 'object' && 'agent' in created && created.agent) {
    return created.agent
  }
  return created as AgentLike
}

async function buildUserMessage(prompt: string): Promise<unknown> {
  try {
    const llm = await import('@deepseek-ai/dsh-llm') as {
      createUserMessage?: (input: {
        content: unknown[]
        source: { kind: string }
      }) => unknown
    }
    if (typeof llm.createUserMessage === 'function') {
      return llm.createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'user' },
      })
    }
  } catch {
    // Unit tests and hosts without dsh-llm still get a user-shaped payload.
  }
  return {
    id: randomId('msg'),
    role: 'user',
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'user' },
  }
}

/**
 * Spawn a new DSH session via the already-registered Agent factory
 * (`lumine-acp-session` or the stock loop). The first user message is the
 * rendered prompt. Stamp `routineId` on the known `request/context` event —
 * DSH persistence rejects unknown types. Never write `schedule/change`.
 */
export async function spawnRoutineSession(
  ctx: DeliverContext,
  routine: Routine,
  now: number = Date.now(),
): Promise<DeliveryResult> {
  if (!ctx.agents?.create) {
    return { ok: false, note: 'agents.create is not available' }
  }
  const prompt = renderRoutinePrompt(routine, now)
  const sessionId = randomId('routine')
  try {
    const created = await ctx.agents.create({
      sessionId,
      meta: {
        cwd: routine.workspaceCwd ?? ctx.cwd ?? process.cwd(),
        ...((routine.preset ?? ctx.defaultPreset)
          ? { agentPreset: routine.preset ?? ctx.defaultPreset }
          : {}),
      },
    })
    const agent = unwrapAgent(created)
    const spawnedId = String(agent.id ?? agent.sessionId ?? sessionId)
    await stampRoutineContext(ctx, agent, spawnedId, routine.id)
    if (typeof agent.send === 'function') {
      const message = await buildUserMessage(prompt)
      const sent = agent.send(message, 'next-turn', true)
      if (sent !== undefined && typeof (sent as Promise<unknown>).then === 'function') {
        await sent
      }
    }
    return { ok: true, sessionId: spawnedId }
  } catch (error) {
    return {
      ok: false,
      note: error instanceof Error ? error.message : String(error),
    }
  }
}

async function stampRoutineContext(
  ctx: DeliverContext,
  agent: AgentLike,
  sessionId: string,
  routineId: string,
): Promise<void> {
  const fromAgent = agent.session
  if (fromAgent && typeof fromAgent.append === 'function') {
    await fromAgent.append('request/context', { routineId })
    return
  }
  const session = await ctx.sessions?.get?.(sessionId)
  if (session && typeof session.append === 'function') {
    await session.append('request/context', { routineId })
  }
}
