import { rpc, valueOf } from '../rpc.mjs'

export const AGENTS = [
  { preset: 'claude-code', provider: 'claude' },
  { preset: 'codex', provider: 'codex' },
  { preset: 'cursor', provider: 'cursor' },
  { preset: 'grok-build', provider: 'grok' },
]

const SKIP_PROMPT = (process.env.DSH_E2E_SKIP_PROMPT ?? '1') === '1'

function extractAssistantText(events) {
  const parts = []
  for (const entry of events || []) {
    const event = entry.event || entry
    const data = event.data || {}
    if (event.type === 'assistant/chunk' && typeof data.text === 'string') parts.push(data.text)
    if (event.type === 'assistant/chunk' && data.chunk && typeof data.chunk.text === 'string') {
      parts.push(data.chunk.text)
    }
    if (event.type === 'assistant/message') {
      const content = data.content || (data.message && data.message.content)
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block.text === 'string') parts.push(block.text)
        }
      } else if (typeof data.text === 'string') {
        parts.push(data.text)
      }
    }
  }
  return parts.join('')
}

async function pollForPong(sessionId, timeoutMs = 180000) {
  const startedAt = Date.now()
  let last

  while (Date.now() - startedAt < timeoutMs) {
    last = valueOf(await rpc('session.history', { sessionId, maxMessages: 50 }, 20000))
    if (last && !last.__error) {
      const text = extractAssistantText(last.events)
      if (text.toLowerCase().includes('pong')) {
        return { ok: true, text, elapsedMs: Date.now() - startedAt }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1500))
  }

  return {
    ok: false,
    text: last && !last.__error ? extractAssistantText(last.events) : null,
    last,
    elapsedMs: Date.now() - startedAt,
  }
}

async function resolveWorkspace(workspaceId) {
  if (workspaceId) return workspaceId
  if (process.env.DSH_E2E_WORKSPACE) return process.env.DSH_E2E_WORKSPACE

  const listed = valueOf(await rpc('workspace.list', {}))
  const items = listed && listed.items
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('No DSH workspace is available; set DSH_E2E_WORKSPACE or open one in dsh web.')
  }
  return items[0].workspaceId
}

async function probeAgent(workspaceId, spec, errors) {
  const row = { preset: spec.preset, provider: spec.provider }
  const created = valueOf(await rpc('session.create', {
    workspaceId,
    agentPreset: spec.preset,
  }, 120000))

  if (!created || created.__error || !created.sessionId) {
    row.create = created
    errors.push({ preset: spec.preset, step: 'session.create', detail: created })
    return row
  }

  row.sessionId = created.sessionId
  row.agentPreset = created.agentPreset
  if (created.agentPreset !== spec.preset) {
    errors.push({
      preset: spec.preset,
      step: 'agent-preset',
      message: `Expected preset ${spec.preset}, got ${created.agentPreset}`,
    })
  }

  const models = valueOf(await rpc('session.models', { sessionId: created.sessionId }))
  row.current = models && models.current
  if (!models || models.__error) {
    errors.push({ preset: spec.preset, step: 'session.models', detail: models })
  } else if (!models.current || models.current.provider !== spec.provider) {
    errors.push({
      preset: spec.preset,
      step: 'current-provider',
      message: `Expected provider ${spec.provider}, got ${models.current && models.current.provider}`,
      current: models.current,
    })
  }

  if (SKIP_PROMPT) return row

  const prompted = valueOf(await rpc('session.prompt', {
    sessionId: created.sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: 'Reply with the single word pong and nothing else.' }],
  }, 40000))
  row.pong = { accepted: prompted && prompted.accepted }
  if (!prompted || prompted.__error) {
    errors.push({ preset: spec.preset, step: 'pong-prompt', detail: prompted })
    return row
  }

  row.pong.history = await pollForPong(created.sessionId)
  if (!row.pong.history.ok) {
    errors.push({ preset: spec.preset, step: 'pong-history', detail: row.pong.history })
  }
  return row
}

export async function runAgentsProbe(workspaceId) {
  const errors = []
  const resolvedWorkspaceId = await resolveWorkspace(workspaceId)
  const agents = {}

  for (const spec of AGENTS) {
    agents[spec.preset] = await probeAgent(resolvedWorkspaceId, spec, errors)
  }

  return {
    name: 'agents',
    ok: errors.length === 0,
    workspaceId: resolvedWorkspaceId,
    skipPrompt: SKIP_PROMPT,
    agents,
    errors,
  }
}
