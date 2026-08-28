/**
 * Common memory surface published as `ctx.memorySource` (id: leyline).
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { FEATURE_CONTEXT_PACK, FEATURE_SESSION_EVENTS } from './capabilities.ts'
import { leylineRecallJson, leylineRememberDreamer } from './cli.ts'
import type { LeylineClient } from './client.ts'
import { MEMORY_SOURCE_ID, type ResolvedConfig } from './config.ts'
import { buildContextPackRequest, compileRecall, type ContextPackResponse } from './payloads.ts'

export interface MemoryRecallHit {
  memoryID: string
  title: string
  score: number
  excerpt: string
}

export interface MemorySource {
  readonly id: string
  health(): Promise<boolean>
  supports(feature: string): boolean
  recall(query: string, limit?: number): Promise<MemoryRecallHit[]>
  remember(input: { title: string; body: string; repoId?: string }): Promise<boolean>
  markUseful(recallId: string, memoryIds?: string[]): Promise<boolean>
  contextPack(query: string, repoId?: string): Promise<ContextPackResponse | undefined>
}

export interface MemorySourceHost {
  client: LeylineClient
  resolved: ResolvedConfig
}

export class LeylineMemorySource extends Service implements MemorySource {
  readonly id = MEMORY_SOURCE_ID

  constructor(
    ctx: Context,
    private readonly host: MemorySourceHost,
  ) {
    super(ctx, 'memorySource')
  }

  private get client(): LeylineClient {
    return this.host.client
  }

  private get config(): ResolvedConfig {
    return this.host.resolved
  }

  async health(): Promise<boolean> {
    try {
      if (!this.client.capabilities.ready) await this.client.probe()
      const snapshot = this.client.capabilities.snapshot
      return snapshot.contract >= 1 || Object.keys(snapshot.features).length > 0
    } catch {
      return false
    }
  }

  supports(feature: string): boolean {
    return this.client.capabilities.supports(feature)
  }

  async contextPack(query: string, repoId?: string): Promise<ContextPackResponse | undefined> {
    try {
      if (!this.client.capabilities.ready) await this.client.probe()
      if (this.client.capabilities.supports(FEATURE_CONTEXT_PACK)) {
        const request = buildContextPackRequest({
          query,
          workspaceId: this.config.workspaceId,
          repoId,
          maxMemories: this.config.maxMemories,
          maxTokens: this.config.maxTokens,
        })
        return await this.client.post('/v1/context-pack', request) as ContextPackResponse | undefined
      }
      const fallback = await leylineRecallJson(query, {
        workspaceId: this.config.workspaceId,
        repoId,
        maxMemories: this.config.maxMemories,
      })
      return fallback as ContextPackResponse | undefined
    } catch {
      return undefined
    }
  }

  async recall(query: string, limit = 4, repoId?: string): Promise<MemoryRecallHit[]> {
    try {
      const pack = await this.contextPack(query, repoId)
      const compiled = compileRecall(pack)
      const memories = pack?.memories ?? []
      return memories.slice(0, limit).map((memory, index) => ({
        memoryID: memory.id ?? compiled.memoryIds[index] ?? `mem_${index}`,
        title: memory.title ?? memory.id ?? 'memory',
        score: memory.score ?? 0,
        excerpt: memory.snippet ?? '',
      }))
    } catch {
      return []
    }
  }

  async remember(input: { title: string; body: string; repoId?: string }): Promise<boolean> {
    try {
      return await leylineRememberDreamer({
        title: input.title,
        body: input.body,
        workspaceId: this.config.workspaceId,
        repoId: input.repoId,
      })
    } catch {
      return false
    }
  }

  async markUseful(recallId: string, memoryIds: string[] = []): Promise<boolean> {
    try {
      if (!this.client.capabilities.ready) await this.client.probe()
      if (
        !this.client.capabilities.supports(FEATURE_SESSION_EVENTS)
        && !this.client.capabilities.supports(FEATURE_CONTEXT_PACK)
      ) {
        return false
      }
      const result = await this.client.post('/v1/recall/mark-useful', {
        recall_id: recallId,
        memory_ids: memoryIds,
      })
      return result !== undefined
    } catch {
      return false
    }
  }
}
