export const BASE = (process.env.DSH_E2E_URL || 'http://127.0.0.1:3080').replace(/\/$/, '')

const API = `${BASE}/api`

export async function rpc(method, payload, timeoutMs = 90000) {
  const rpcId = crypto.randomUUID()
  const body = JSON.stringify({ type: 'client-request', rpcId, method, payload })
  const ac = new AbortController()
  const timeout = setTimeout(() => ac.abort(), timeoutMs)

  try {
    const response = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: new URL(BASE).host },
      body,
      signal: ac.signal,
    })
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      return { http: response.status, raw: text.slice(0, 500) }
    }
    return { http: response.status, json }
  } catch (error) {
    return { error: String(error && error.message ? error.message : error) }
  } finally {
    clearTimeout(timeout)
  }
}

export function valueOf(response) {
  const result = response && response.json && response.json.result
  if (!result) return { __error: response }
  if (result.ok) return result.value
  return { __error: result }
}

/** Typert remotes (routine/*, commands/*, tokenSaver/*) take `{ args }` not a bare payload. */
export function typert(method, args = {}, timeoutMs = 90000) {
  return rpc(method, { args }, timeoutMs)
}
