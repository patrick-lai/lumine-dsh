#!/usr/bin/env node
/**
 * Live DSH web e2e: create a session for every ACP preset, assert the picker
 * current is that product (not the host-wide grok/DeepSeek default), then
 * ping/pong through the official child.
 *
 *   DSH_E2E_URL=http://127.0.0.1:3080 node packages/acp-session/scripts/e2e-agents.mjs
 *
 * Optional: DSH_E2E_WORKSPACE=<workspaceId>  DSH_E2E_SKIP_PROMPT=1
 */
const BASE = (process.env.DSH_E2E_URL || 'http://127.0.0.1:3080').replace(/\/$/, '')
const API = `${BASE}/api`
const SKIP_PROMPT = process.env.DSH_E2E_SKIP_PROMPT === '1'
const AGENTS = [
  { preset: 'claude-code', provider: 'claude' },
  { preset: 'codex', provider: 'codex' },
  { preset: 'cursor', provider: 'cursor' },
  { preset: 'grok-build', provider: 'grok' },
]

const errors = []
const report = { base: BASE, agents: {}, errors }

async function rpc(method, payload, timeoutMs = 90000) {
  const rpcId = crypto.randomUUID()
  const body = JSON.stringify({ type: 'client-request', rpcId, method, payload })
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: new URL(BASE).host },
      body,
      signal: ac.signal,
    })
    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch {
      return { http: res.status, raw: text.slice(0, 500) }
    }
    return { http: res.status, json }
  } catch (error) {
    return { error: String(error && error.message ? error.message : error) }
  } finally {
    clearTimeout(t)
  }
}

function valueOf(resp) {
  const r = resp && resp.json && resp.json.result
  if (!r) return { __error: resp }
  if (r.ok) return r.value
  return { __error: r }
}

function extractAssistantText(events) {
  const parts = []
  for (const entry of events || []) {
    const ev = entry.event || entry
    const type = ev.type
    const data = ev.data || {}
    if (type === 'assistant/chunk' && typeof data.text === 'string') parts.push(data.text)
    if (type === 'assistant/chunk' && data.chunk && typeof data.chunk.text === 'string') parts.push(data.chunk.text)
    if (type === 'assistant/message') {
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

async function pollHistory(sessionId, needle, timeoutMs = 180000) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    const hist = await rpc('session.history', { sessionId, maxMessages: 50 }, 20000)
    const val = valueOf(hist)
    last = val
    if (val && !val.__error) {
      const text = extractAssistantText(val.events)
      if (text.toLowerCase().includes(needle.toLowerCase())) {
        return { ok: true, text, elapsedMs: Date.now() - start }
      }
    }
    await new Promise(r => setTimeout(r, 1500))
  }
  return {
    ok: false,
    text: last && !last.__error ? extractAssistantText(last.events) : null,
    last,
    elapsedMs: Date.now() - start,
  }
}

async function resolveWorkspace() {
  if (process.env.DSH_E2E_WORKSPACE) return process.env.DSH_E2E_WORKSPACE
  const listed = valueOf(await rpc('workspace.list', {}))
  const items = listed && listed.items
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('no workspace; set DSH_E2E_WORKSPACE')
  }
  return items[0].workspaceId
}

async function runAgent(workspaceId, spec) {
  const row = { preset: spec.preset, provider: spec.provider }
  const created = valueOf(await rpc('session.create', {
    workspaceId,
    agentPreset: spec.preset,
  }, 120000))
  if (!created || created.__error || !created.sessionId) {
    row.create = created
    errors.push({ preset: spec.preset, step: 'create', detail: created })
    return row
  }
  row.sessionId = created.sessionId
  row.agentPreset = created.agentPreset
  if (created.agentPreset !== spec.preset) {
    errors.push({ preset: spec.preset, step: 'preset', got: created.agentPreset })
  }

  const models = valueOf(await rpc('session.models', { sessionId: created.sessionId }))
  row.models = {
    current: models && models.current,
    routable: models && models.routable,
    groups: (models && models.groups || []).map(g => ({
      id: g.id,
      models: (g.models || []).map(m => m.id),
    })),
  }
  const current = models && models.current
  if (!current || current.provider !== spec.provider) {
    errors.push({
      preset: spec.preset,
      step: 'picker-current',
      message: `expected provider ${spec.provider}, got ${current && current.provider}`,
      current,
    })
  }
  if (!models || models.routable !== true) {
    errors.push({ preset: spec.preset, step: 'routable', models: row.models })
  }
  const own = (models && models.groups || []).find(g => g.id === spec.provider)
  if (!own || !own.models || own.models.length === 0) {
    errors.push({ preset: spec.preset, step: 'catalog', groups: row.models.groups })
  }

  if (SKIP_PROMPT) return row

  const pong = valueOf(await rpc('session.prompt', {
    sessionId: created.sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: 'Reply with the single word pong and nothing else.' }],
  }, 40000))
  row.firstPrompt = { accepted: pong && pong.accepted }
  if (!pong || pong.__error) {
    errors.push({ preset: spec.preset, step: 'pong-prompt', detail: pong })
    return row
  }
  const pongHist = await pollHistory(created.sessionId, 'pong')
  row.firstPrompt.history = pongHist
  if (!pongHist.ok) errors.push({ preset: spec.preset, step: 'pong-history', detail: pongHist })

  const ping = valueOf(await rpc('session.prompt', {
    sessionId: created.sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: 'Reply with the single word ping and nothing else.' }],
  }, 40000))
  row.followUp = { accepted: ping && ping.accepted }
  if (!ping || ping.__error) {
    errors.push({ preset: spec.preset, step: 'ping-prompt', detail: ping })
    return row
  }
  const pingHist = await pollHistory(created.sessionId, 'ping')
  row.followUp.history = pingHist
  if (!pingHist.ok) errors.push({ preset: spec.preset, step: 'ping-history', detail: pingHist })
  return row
}

async function main() {
  const workspaceId = await resolveWorkspace()
  report.workspaceId = workspaceId
  for (const spec of AGENTS) {
    report.agents[spec.preset] = await runAgent(workspaceId, spec)
  }
  report.ok = errors.length === 0
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exit(1)
}

main().catch(error => {
  errors.push({ step: 'fatal', error: String(error && error.stack ? error.stack : error) })
  report.ok = false
  console.error(error)
  console.log(JSON.stringify(report, null, 2))
  process.exit(1)
})
