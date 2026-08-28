/**
 * Fire-and-forget HTTP client for an already-running Leyline daemon.
 * A transport miss is never thrown to the session path.
 */

import { CapabilityCache, parseCapabilities, type LeylineCapabilities } from './capabilities.ts'

export interface LeylineHttpOptions {
  baseUrl: string
  timeoutMs: number
  fetchImpl?: typeof fetch
}

export class LeylineHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'LeylineHttpError'
  }
}

export class LeylineClient {
  readonly capabilities = new CapabilityCache()
  private readonly fetchImpl: typeof fetch
  private probing: Promise<LeylineCapabilities> | undefined

  constructor(private readonly options: LeylineHttpOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  get baseUrl(): string {
    return this.options.baseUrl.replace(/\/+$/, '')
  }

  url(path: string): string {
    const suffix = path.startsWith('/') ? path : `/${path}`
    return `${this.baseUrl}${suffix}`
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ ok: true; status: number; json: unknown } | { ok: false; status?: number; error: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs)
    try {
      const init: RequestInit = {
        method,
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      }
      if (body !== undefined) {
        init.headers = { ...init.headers as Record<string, string>, 'Content-Type': 'application/json' }
        init.body = JSON.stringify(body)
      }
      const response = await this.fetchImpl(this.url(path), init)
      let json: unknown
      try {
        json = await response.json()
      } catch {
        json = undefined
      }
      if (!response.ok) {
        return { ok: false, status: response.status, error: `HTTP ${response.status}` }
      }
      return { ok: true, status: response.status, json }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    } finally {
      clearTimeout(timer)
    }
  }

  async probe(): Promise<LeylineCapabilities> {
    if (this.probing) return this.probing
    this.probing = this.probeOnce().finally(() => {
      this.probing = undefined
    })
    return this.probing
  }

  private async probeOnce(): Promise<LeylineCapabilities> {
    const result = await this.request('GET', '/v1/dashboard/snapshot')
    if (!result.ok) return this.capabilities.degrade()
    const snapshot = result.json && typeof result.json === 'object'
      ? result.json as { capabilities?: unknown }
      : undefined
    return this.capabilities.remember(parseCapabilities(snapshot?.capabilities))
  }

  async post(path: string, body: unknown): Promise<unknown | undefined> {
    const result = await this.request('POST', path, body)
    return result.ok ? result.json : undefined
  }
}
