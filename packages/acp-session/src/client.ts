import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PermissionMode } from './config.ts'
import type { AcpUpdate } from './events.ts'
import { decidePermission } from './permission.ts'
import { spawnOfficial, type SpawnedChild } from './process.ts'
import type { ResolvedLaunch } from './providers.ts'
import { NdjsonRpc } from './rpc.ts'

export interface AcpPromptBlock {
  type: 'text'
  text: string
}

export interface AcpChildOptions {
  launch: ResolvedLaunch
  cwd: string
  permission: PermissionMode
  agent: Agent
  env?: NodeJS.ProcessEnv
  approval?: Parameters<typeof decidePermission>[1]['approval']
  resumeSessionId?: string
}

export interface InitializeResult {
  protocolVersion?: number
  authMethods?: Array<{ id?: string; name?: string }>
}

/**
 * Long-lived official CLI child speaking ACP over stdio.
 * One child per DSH session; followups reuse the same ACP session id.
 */
export class AcpChild {
  private rpc: NdjsonRpc | undefined
  private spawned: SpawnedChild | undefined
  private sessionId: string | undefined

  constructor(private readonly options: AcpChildOptions) {}

  get acpSessionId(): string | undefined {
    return this.sessionId
  }

  async ensure(): Promise<string> {
    if (this.sessionId && this.rpc) return this.sessionId
    const spawned = spawnOfficial(this.options.launch, this.options.cwd, this.options.env)
    this.spawned = spawned
    const rpc = new NdjsonRpc(spawned.process.stdin, spawned.process.stdout)
    this.rpc = rpc

    rpc.onNotification('session/update', params => {
      this.onUpdate?.((params as { update?: AcpUpdate }).update ?? params as AcpUpdate)
    })
    rpc.onRequest('session/request_permission', async params => {
      return decidePermission(params as Parameters<typeof decidePermission>[0], {
        mode: this.options.permission,
        agent: this.options.agent,
        approval: this.options.approval,
      })
    })
    // Cursor extension methods block the agent if unanswered.
    rpc.onRequest('cursor/ask_question', () => ({ outcome: { outcome: 'skipped', reason: 'yolo' } }))
    rpc.onRequest('cursor/create_plan', () => ({ outcome: { outcome: 'accepted' } }))

    const init = await rpc.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'lumine-dsh-acp-session', version: '0.1.0' },
    }) as InitializeResult
    const wanted = this.options.launch.authMethod
    const methods = init.authMethods ?? []
    if (wanted && methods.some(method => method.id === wanted)) {
      await rpc.request('authenticate', { methodId: wanted })
    }

    if (this.options.resumeSessionId) {
      try {
        await rpc.request('session/load', {
          sessionId: this.options.resumeSessionId,
          cwd: this.options.cwd,
          mcpServers: [],
        })
        this.sessionId = this.options.resumeSessionId
        return this.sessionId
      } catch {
        // Fall through to session/new when the product cannot load the id.
      }
    }

    const created = await rpc.request('session/new', {
      cwd: this.options.cwd,
      mcpServers: [],
    }) as { sessionId?: unknown }
    if (typeof created.sessionId !== 'string' || !created.sessionId) {
      throw new Error('ACP child published without a session id')
    }
    this.sessionId = created.sessionId
    return this.sessionId
  }

  onUpdate: ((update: AcpUpdate) => void) | undefined

  async prompt(prompt: AcpPromptBlock[], signal?: AbortSignal): Promise<{ stopReason?: string }> {
    const sessionId = await this.ensure()
    const rpc = this.rpc
    if (rpc === undefined) throw new Error('ACP RPC missing after ensure()')
    const onAbort = (): void => {
      rpc.notify('session/cancel', { sessionId })
    }
    if (signal?.aborted) {
      onAbort()
      throw signal.reason instanceof Error ? signal.reason : new Error('cancelled')
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const result = await rpc.request('session/prompt', { sessionId, prompt }) as { stopReason?: string }
      return result
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  cancel(): void {
    if (this.sessionId && this.rpc) {
      this.rpc.notify('session/cancel', { sessionId: this.sessionId })
    }
  }

  async dispose(): Promise<void> {
    this.rpc?.close()
    this.rpc = undefined
    await this.spawned?.dispose()
    this.spawned = undefined
  }
}
