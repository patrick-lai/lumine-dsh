import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { composeDump, mountedIds, parsePatchOps, STOCK_DSH_BASE } from './compose-dump.ts'

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

const rootOverlay = read('../../../cordis.patch.yml')
const acpOverlay = read('../../acp-session/cordis.patch.yml')
const goalOverlay = read('../cordis.patch.yml')
const grokPreset = read('../../acp-session/presets/grok-build/agent.cordis.yml')

describe('dump-config for grok-build / this ACP bundle', () => {
  it('parses the host disable of goal-round-driver from the root overlay', () => {
    const ops = parsePatchOps(rootOverlay)
    expect(ops.some(op => op.kind === 'update' && op.row.id === 'goal-round-driver' && op.row.disabled)).toBe(true)
    expect(ops.some(op => op.kind === 'insert' && op.rows.some(row => row.id === 'lumine-goal-completion'))).toBe(true)
  })

  it('composed dump: goal-round-driver absent from the mounted set, lumine harvest present', () => {
    const dump = composeDump(STOCK_DSH_BASE, rootOverlay)
    const mounted = mountedIds(dump)
    expect(dump.get('goal-round-driver')?.disabled).toBe(true)
    expect(mounted).not.toContain('goal-round-driver')
    expect(mounted).toContain('lumine-goal-completion')
    expect(mounted).toContain('lumine-acp-session')
    expect(mounted).not.toContain('agent-loop')
    expect(mounted).toContain('llm-deepseek')
    expect(mounted).toContain('goal')
  })

  it('one-by-one ACP overlay also unmounts the host driver in dump-config', () => {
    const dump = composeDump(STOCK_DSH_BASE, acpOverlay, goalOverlay)
    const mounted = mountedIds(dump)
    expect(mounted).not.toContain('goal-round-driver')
    expect(mounted).toContain('lumine-acp-session')
    expect(mounted).toContain('lumine-goal-completion')
  })

  it('goal-completion-only overlay does not disable the native driver', () => {
    const dump = composeDump(STOCK_DSH_BASE, goalOverlay)
    expect(mountedIds(dump)).toContain('goal-round-driver')
    expect(mountedIds(dump)).toContain('lumine-goal-completion')
  })

  it('grok-build preset composition disables the driver and mounts no DSH tools', () => {
    const dump = composeDump([], grokPreset)
    expect(dump.get('goal-round-driver')?.disabled).toBe(true)
    expect(mountedIds(dump)).toEqual([])
  })
})
