import { describe, expect, it } from 'vitest'
import {
  collectRun,
  memberFromNode,
  roleInRun,
  tallyRoles,
  type ChatNodeLike,
} from '../src/client/group.ts'

function kindsOf(labels: string[]): (string | undefined)[] {
  return labels.map(label => label === 't' ? 'tool-call' : label === 'a' ? 'assistant' : label)
}

function running(id: string, name: string, args = '{}'): ChatNodeLike {
  return {
    key: id,
    kind: 'tool-call',
    data: { root: { callId: id, name, argsRaw: args } },
  }
}

describe('Lumine-style tool run folding', () => {
  it('keeps a single tool as solo so a one-item group is not created', () => {
    expect(roleInRun(kindsOf(['a', 't', 'a']), 1)).toBe('solo')
    expect(roleInRun(['tool-call'], 0)).toBe('solo')
  })

  it('folds a consecutive tool run of 2+ into one leader plus followers', () => {
    const kinds = kindsOf(['a', 't', 't', 't', 'a'])
    expect(roleInRun(kinds, 1)).toBe('leader')
    expect(roleInRun(kinds, 2)).toBe('follower')
    expect(roleInRun(kinds, 3)).toBe('follower')
    expect(roleInRun(kinds, 0)).toBe('solo')
    expect(roleInRun(kinds, 4)).toBe('solo')
  })

  it('splits runs that an assistant message interrupts', () => {
    const kinds = kindsOf(['t', 't', 'a', 't', 't'])
    expect(roleInRun(kinds, 0)).toBe('leader')
    expect(roleInRun(kinds, 1)).toBe('follower')
    expect(roleInRun(kinds, 3)).toBe('leader')
    expect(roleInRun(kinds, 4)).toBe('follower')
  })

  it('turns 100 consecutive tools into one leader and 99 followers', () => {
    const kinds = Array.from({ length: 100 }, () => 'tool-call')
    const tally = tallyRoles(kinds)
    expect(tally).toEqual({ solo: 0, leader: 1, follower: 99 })
    expect(`${kinds.length} tools -> ${tally.leader} leader + ${tally.follower} followers`)
      .toBe('100 tools -> 1 leader + 99 followers')
  })

  it('collects the leader run members in order', () => {
    const order = ['u', 't1', 't2', 't3', 'a']
    const store = new Map<string, ChatNodeLike>([
      ['u', { kind: 'user' }],
      ['t1', running('t1', 'read_file', '{"path":"a.ts"}')],
      ['t2', running('t2', 'grep', '{"pattern":"foo"}')],
      ['t3', running('t3', 'read_file', '{"path":"b.ts"}')],
      ['a', { kind: 'assistant' }],
    ])
    const nodes = { get: (key: string) => store.get(key) }
    expect(collectRun(order, nodes, 't2').role).toBe('follower')
    const lead = collectRun(order, nodes, 't1')
    expect(lead.role).toBe('leader')
    expect(lead.members.map(member => member.toolName)).toEqual(['read_file', 'grep', 'read_file'])
    expect(collectRun(order, nodes, 'a').role).toBe('solo')
  })

  it('reads a settled tool name off the paired call head', () => {
    const member = memberFromNode('x', {
      kind: 'tool-call',
      data: {
        root: {
          kind: 'tool-result',
          callId: 'x',
          call: { name: 'read_file', argsRaw: '{"path":"a.ts"}' },
          isError: false,
        },
      },
    })
    expect(member?.toolName).toBe('read_file')
    expect(member?.callId).toBe('x')
  })
})
