import { describe, expect, it } from 'vitest'
import {
  resultText,
  subCallsOf,
  toolViewOwner,
  walkToolTree,
  type ToolCallBlockLike,
} from '../src/client/group.ts'
import { en } from '../src/client/locales.ts'

function running(id: string, name: string, children: ToolCallBlockLike[] = []): ToolCallBlockLike {
  return { callId: id, name, argsRaw: '{}', subCalls: children }
}

describe('recursive tool tree', () => {
  it('walks nested subCalls in dispatch order', () => {
    const root = running('root', 'dispatch', [
      running('a', 'read_file'),
      running('b', 'grep', [running('b1', 'read_file')]),
    ])
    expect(walkToolTree(root).map(block => block.callId)).toEqual(['root', 'a', 'b', 'b1'])
    expect(subCallsOf(root).map(block => block.callId)).toEqual(['a', 'b'])
  })

  it('surfaces settled result and error text for the fallback card', () => {
    expect(resultText({
      kind: 'tool-result',
      callId: '1',
      call: { name: 'read_file', argsRaw: '{}' },
      isError: false,
      content: [{ type: 'text', text: 'file contents' }],
    })).toBe('file contents')
    expect(resultText({
      kind: 'tool-result',
      callId: '2',
      call: { name: 'grep', argsRaw: '{}' },
      isError: true,
      error: { name: 'Error', code: 'ENOENT' },
    })).toBe('Error: ENOENT')
    expect(resultText(running('3', 'read_file'))).toBe('')
  })

  it('forwards openFile and inspectCall on the tool.call.toolview owner', () => {
    const opened: string[] = []
    const inspected: string[] = []
    const owner = toolViewOwner(running('c1', 'read_file'), {
      cwd: '/tmp',
      openFile: path => { opened.push(path) },
      inspectCall: id => { inspected.push(id) },
    })
    expect(owner.callId).toBe('c1')
    expect(owner.toolName).toBe('read_file')
    expect(owner.cwd).toBe('/tmp')
    expect(typeof owner.openFile).toBe('function')
    expect(typeof owner.inspect).toBe('function')
    ;(owner.openFile as (path: string) => void)('a.ts')
    ;(owner.inspect as () => void)()
    expect(opened).toEqual(['a.ts'])
    expect(inspected).toEqual(['c1'])
  })
})

describe('accessible outcome copy', () => {
  it('ships localized running/completed/failed labels and a failure count', () => {
    expect(en.running).toBe('running')
    expect(en.completed).toBe('completed')
    expect(en.failed).toBe('failed')
    expect(en.failedCount.replace('{n}', '3')).toBe('3 failed')
    expect(en.mixed).toBe('mixed')
  })
})
