import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

export type JsonRpcId = number | string

/** JSON-RPC error from the ACP child, with the numeric code intact. */
export class AcpRpcError extends Error {
  constructor(
    readonly rpcCode: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message)
    this.name = 'AcpRpcError'
  }
}

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export type NotificationHandler = (params: unknown) => void
export type RequestHandler = (params: unknown, id: JsonRpcId) => Promise<unknown> | unknown

/** JSON-RPC 2.0 over newline-delimited JSON (ACP stdio). */
export class NdjsonRpc {
  private nextId = 1
  private readonly pending = new Map<JsonRpcId, Pending>()
  private readonly notifications = new Map<string, NotificationHandler>()
  private readonly requests = new Map<string, RequestHandler>()
  private closed = false

  constructor(
    private readonly stdin: Writable,
    stdout: Readable,
  ) {
    const lines = createInterface({ input: stdout })
    lines.on('line', line => this.onLine(line))
    lines.on('close', () => this.failAll(new Error('ACP child closed stdout')))
  }

  onNotification(method: string, handler: NotificationHandler): void {
    this.notifications.set(method, handler)
  }

  onRequest(method: string, handler: RequestHandler): void {
    this.requests.set(method, handler)
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error(`ACP RPC closed; cannot send ${method}`))
    const id = this.nextId++
    this.write({ jsonrpc: '2.0', id, method, params })
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return
    this.write({ jsonrpc: '2.0', method, params })
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result })
  }

  close(): void {
    this.closed = true
    this.failAll(new Error('ACP RPC closed'))
  }

  private write(message: object): void {
    this.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private onLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    let message: JsonRpcRequest & JsonRpcResponse
    try {
      message = JSON.parse(trimmed) as JsonRpcRequest & JsonRpcResponse
    } catch {
      return
    }
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined) && message.method === undefined) {
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      this.pending.delete(message.id)
      if (message.error) {
        waiter.reject(new AcpRpcError(
          message.error.code,
          message.error.message,
          message.error.data,
        ))
        return
      }
      waiter.resolve(message.result)
      return
    }
    if (typeof message.method === 'string' && message.id !== undefined) {
      const handler = this.requests.get(message.method)
      if (handler === undefined) {
        this.write({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `Method not found: ${message.method}` },
        })
        return
      }
      void Promise.resolve(handler(message.params, message.id)).then(
        result => this.respond(message.id as JsonRpcId, result),
        error => this.write({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
        }),
      )
      return
    }
    if (typeof message.method === 'string') {
      this.notifications.get(message.method)?.(message.params)
    }
  }

  private failAll(error: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(error)
    this.pending.clear()
  }
}
