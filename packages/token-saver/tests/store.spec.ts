import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { load, parseLevel, save } from '../src/store.ts'

function env(home: string): NodeJS.ProcessEnv { return { DSH_HOME: home } }

describe('token saver store', () => {
  it('defaults to light, parses unknown levels as light, and persists all levels', () => {
    const home = mkdtempSync(join(tmpdir(), 'lumine-token-saver-'))
    expect(load(env(home))).toEqual({ level: 'light' })
    expect(parseLevel('nope')).toBe('light')
    for (const level of ['off', 'light', 'balanced', 'aggressive'] as const) {
      expect(save(level, env(home))).toEqual({ level })
      expect(load(env(home))).toEqual({ level })
    }
  })

  it('uses the state file as the source of truth', () => {
    const home = mkdtempSync(join(tmpdir(), 'lumine-token-saver-file-wins-'))
    const path = join(home, '.lumine-token-saver.json')
    writeFileSync(path, JSON.stringify({ level: 'aggressive' }))
    expect(load({ DSH_HOME: home, LUMINE_TOKEN_SAVER_LEVEL: 'off' })).toEqual({ level: 'aggressive' })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ level: 'aggressive' })
  })
})
