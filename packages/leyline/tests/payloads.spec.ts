import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SOURCE_CLIENT_ID } from '../src/config.ts'
import {
  buildContextPackRequest,
  buildLifecycleEvent,
  buildMaterializeRequest,
  buildSessionEventsPayload,
  compileRecall,
  settleIdempotencyKey,
} from '../src/payloads.ts'

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
}

describe('Leyline payload shapes', () => {
  it('emits the pinned context-pack request', () => {
    expect(buildContextPackRequest({
      query: 'fix flaky test',
      workspaceId: 'ws_local',
      repoId: 'patrick-lai/lumine-dsh',
      maxMemories: 4,
      maxTokens: 1200,
    })).toEqual(fixture('context_pack.v1.json'))
  })

  it('emits the pinned lifecycle event with lumine-dsh as source_client_id', () => {
    const payload = buildLifecycleEvent({
      kind: 'workspace_removed',
      workspaceId: 'ws_local',
      repoId: 'patrick-lai/lumine-dsh',
      worktreePath: '/tmp/ws',
    })
    expect(payload).toEqual(fixture('lifecycle.v1.json'))
    expect(payload.source_client_id).toBe(SOURCE_CLIENT_ID)
    expect(payload.source_client_id).not.toBe('raphael')
  })

  it('emits the pinned materialize request', () => {
    expect(buildMaterializeRequest({
      path: '/tmp/ws',
      workspaceId: 'ws_local',
      repoId: 'patrick-lai/lumine-dsh',
    })).toEqual(fixture('materialize.v1.json'))
  })

  it('emits the pinned session-events payload with settle key and receipt block', () => {
    const payload = buildSessionEventsPayload({
      sourceSessionId: 'sess-1',
      workspaceId: 'ws_local',
      workspacePath: '/tmp/ws',
      repoId: 'patrick-lai/lumine-dsh',
      title: 'grok-build',
      startedAt: '2026-08-28T09:00:00Z',
      settledAt: '2026-08-28T09:30:00Z',
      digest: [
        'Outcome captured at session settlement by lumine-dsh (ground-truth result recorded after the agent session ended).',
        'GOAL: Fix flaky test',
        'RESULT: success · tests green',
        'SUMMARY: Root cause: race in the cache.',
      ].join('\n'),
      tail: 'Test Suite passed',
      durationSeconds: 1800,
      agent: 'grok-build',
      receipt: {
        result: 'success',
        label: 'success · tests green',
        recall_ids: ['recall_abc123'],
        diff_stat: '+18 -4',
      },
    })
    expect(payload).toEqual(fixture('lumine_dsh_session_events.v1.json'))
    expect(settleIdempotencyKey('sess-1')).toBe('lumine-dsh-settle-sess-1')
    const source = payload.source_client as { client_id: string }
    expect(source.client_id).toBe('lumine-dsh')
    expect(source.client_id).not.toBe('raphael')
    const extensions = payload.extensions as {
      'lumine-dsh': { receipt: { result: string; recall_ids: string[] } }
    }
    expect(extensions['lumine-dsh'].receipt.result).toBe('success')
    expect(extensions['lumine-dsh'].receipt.recall_ids).toEqual(['recall_abc123'])
  })

  it('compiles a context-pack into host recall text and recall_ids', () => {
    const compiled = compileRecall({
      recall_id: 'recall_abc123',
      memories: [
        { id: 'mem_1', title: 'Race in cache', score: 0.91, snippet: 'isolate the actor' },
      ],
    })
    expect(compiled.recallIds).toEqual(['recall_abc123'])
    expect(compiled.memoryIds).toEqual(['mem_1'])
    expect(compiled.text).toContain('Leyline recall')
    expect(compiled.text).toContain('Race in cache')
    expect(compileRecall(undefined).text).toBe('')
  })
})
