import { describe, expect, it } from 'vitest'
import { faceSnapshot, targetFor, toolKind, verbFor, type ToolMember } from '../src/client/face.ts'

function member(name: string, args: string, state: 'running' | 'ok' | 'err' = 'ok'): ToolMember {
  if (state === 'running') {
    return {
      key: name,
      callId: name,
      toolName: name,
      block: { callId: name, name, argsRaw: args },
    }
  }
  return {
    key: name,
    callId: name,
    toolName: name,
    block: {
      kind: 'tool-result',
      callId: name,
      call: { name, argsRaw: args },
      isError: state === 'err',
    },
  }
}

describe('Lumine activity-strip face', () => {
  it('maps ACP wire names to Lumine verbs instead of Tool call · read_file', () => {
    expect(verbFor('read_file')).toBe('Read')
    expect(toolKind('read_file')).toBe('read')
    expect(verbFor('grep')).toBe('Search')
    expect(verbFor('search_tool')).toBe('Search')
    expect(verbFor('web_fetch')).toBe('Fetch')
    expect(verbFor('run_terminal_command')).toBe('Run')
    expect(verbFor('search_replace')).toBe('Edit')
    expect(verbFor('write')).toBe('Write')
  })

  it('pulls a path or query out of ACP JSON args', () => {
    expect(targetFor({ callId: '1', name: 'read_file', argsRaw: '{"path":"src/a.ts"}' })).toBe('src/a.ts')
    expect(targetFor({
      callId: '1',
      name: 'grep',
      argsRaw: '{"pattern":"worktree"}',
    })).toBe('worktree')
  })

  it('names the latest in-flight verb while the run is working', () => {
    const face = faceSnapshot([
      member('read_file', '{"path":"a.ts"}', 'ok'),
      member('grep', '{"pattern":"foo"}', 'running'),
    ])
    expect(face.working).toBe(true)
    expect(face.verb).toBe('Search')
    expect(face.target).toBe('foo')
    expect(face.outcome).toBe('working')
    expect(face.count).toBe(2)
  })

  it('summarizes a settled read+search run the way Lumine does', () => {
    const face = faceSnapshot([
      member('read_file', '{"path":"a.ts"}'),
      member('read_file', '{"path":"b.ts"}'),
      member('grep', '{"pattern":"x"}'),
    ])
    expect(face.working).toBe(false)
    expect(face.outcome).toBe('succeeded')
    expect(face.summary).toBe('2 files read · 1 search')
  })

  it('treats a later same-kind success as a recovered failure, not a red run', () => {
    const face = faceSnapshot([
      member('read_file', '{"path":"a.ts"}', 'err'),
      member('read_file', '{"path":"a.ts"}', 'ok'),
    ])
    expect(face.outcome).toBe('succeeded')
    expect(face.failed).toBe(0)
    expect(face.recovered).toBe(1)
  })
})
