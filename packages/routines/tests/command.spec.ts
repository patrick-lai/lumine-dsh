import { describe, expect, it } from 'vitest'
import { parseCreateFlags, parseRoutineCommand } from '../src/command.ts'
import { renderTemplate } from '../src/calendar.ts'

describe('routine command grammar', () => {
  it('parses create flags for cron, grind, and quiet hours', () => {
    expect(parseCreateFlags('--cron 0 9 * * 1-5 --grind --quiet 22:00-07:00', 'UTC')).toEqual({
      rule: { kind: 'cron', cron: '0 9 * * 1-5' },
      mode: 'grind',
      quietHours: { startMinute: 22 * 60, endMinute: 7 * 60, timeZoneIdentifier: 'UTC' },
    })
    expect(parseCreateFlags('--every 3600', 'UTC')).toEqual({
      rule: { kind: 'interval', seconds: 3600 },
      mode: 'cron',
    })
    expect(parseRoutineCommand('delete abc-1')).toEqual({ kind: 'delete', id: 'abc-1' })
    expect(parseRoutineCommand('create morning -- Review the inbox --cron 0 9 * * 1-5 --grind')).toEqual({
      kind: 'create',
      title: 'morning',
      prompt: 'Review the inbox',
      extra: '--cron 0 9 * * 1-5 --grind',
    })
  })

  it('renders prompt parameters without touching dsh-schedule tools', () => {
    expect(renderTemplate('Review the inbox for {owner}', { owner: 'patrick' })).toBe('Review the inbox for patrick')
  })
})
