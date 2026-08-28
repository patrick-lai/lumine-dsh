import { describe, expect, it } from 'vitest'
import { recallJsonArgs, rememberDreamerArgs } from '../src/cli.ts'

describe('live leyline CLI argv', () => {
  it('remember requires --title and --body (stdin is not a body source)', () => {
    const args = rememberDreamerArgs({
      title: 'Fix pattern',
      body: 'Durable lesson from the session.',
      workspaceId: 'ws_local',
      repoId: 'patrick-lai/lumine-dsh',
    })
    expect(args).toContain('--body')
    expect(args).toContain('Durable lesson from the session.')
    expect(args).toContain('--title')
    expect(args).toContain('Fix pattern')
    expect(args).toContain('--stage')
    expect(args).toContain('dreamer')
    expect(args).toContain('--repo-id')
    expect(args).toContain('patrick-lai/lumine-dsh')
    expect(args).toContain('--lane')
    expect(args).toContain('repo')
    expect(args.indexOf('--body')).toBeLessThan(args.indexOf('Durable lesson from the session.'))
    expect(args[args.indexOf('--body') + 1]).toBe('Durable lesson from the session.')
  })

  it('recall requires --query, not a positional', () => {
    const args = recallJsonArgs({
      query: 'fix flaky test',
      workspaceId: 'ws_local',
      repoId: 'patrick-lai/lumine-dsh',
      maxMemories: 4,
    })
    expect(args[0]).toBe('recall')
    expect(args).toContain('--query')
    expect(args[args.indexOf('--query') + 1]).toBe('fix flaky test')
    expect(args).toContain('--json')
    expect(args).toContain('--repo-id')
    expect(args).toContain('patrick-lai/lumine-dsh')
    expect(args).toContain('--max-memories')
    expect(args).toContain('4')
    expect(args.includes('fix flaky test') && args[args.indexOf('fix flaky test') - 1]).not.toBe('recall')
  })
})
