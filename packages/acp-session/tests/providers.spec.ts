import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MissingCliError,
  resolveLaunch,
  resolveProviderId,
  whichOnPath,
} from '../src/providers.ts'

function binDir(name: string, files: string[]): string {
  const dir = join(tmpdir(), `lumine-acp-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  for (const file of files) {
    const path = join(dir, file)
    writeFileSync(path, '#!/bin/sh\nexit 0\n')
    chmodSync(path, 0o755)
  }
  return dir
}

describe('provider id aliases', () => {
  it('maps web presets and does not treat agent as Cursor', () => {
    expect(resolveProviderId({ preset: 'claude-code', fallback: 'grok' })).toBe('claude')
    expect(resolveProviderId({ preset: 'grok-build', fallback: 'claude' })).toBe('grok')
    expect(resolveProviderId({ provider: 'cursor', fallback: 'claude' })).toBe('cursor')
    expect(resolveProviderId({ provider: 'agent', fallback: 'claude' })).toBe('claude')
  })
})

describe('command resolution', () => {
  it('defaults Cursor to cursor-agent acp, never PATH `agent`', () => {
    const dir = binDir('cursor', ['cursor-agent', 'agent'])
    const launch = resolveLaunch('cursor', {
      pathDirs: [dir],
      env: { PATH: dir, HOME: dir },
    })
    expect(launch.command).toBe(join(dir, 'cursor-agent'))
    expect(launch.args).toEqual(['acp'])
    expect(launch.authMethod).toBe('cursor_login')
    expect(launch.command.endsWith('agent') && !launch.command.endsWith('cursor-agent')).toBe(false)
  })

  it('fails Cursor when only `agent` exists (Grok collision)', () => {
    const dir = binDir('agent-only', ['agent'])
    expect(() => resolveLaunch('cursor', { pathDirs: [dir], env: { PATH: dir, HOME: dir } })).toThrow(MissingCliError)
    try {
      resolveLaunch('cursor', { pathDirs: [dir], env: { PATH: dir, HOME: dir } })
    } catch (error) {
      expect(String(error)).toMatch(/Install Cursor and log in/)
      expect(String(error)).not.toMatch(/ECONNREFUSED|ENOENT/)
    }
  })

  it('points Claude ACP adapter at the user claude binary and unsets the API key', () => {
    const dir = binDir('claude', ['claude', 'npx'])
    const launch = resolveLaunch('claude', {
      pathDirs: [dir],
      env: { PATH: dir, HOME: dir },
    })
    expect(launch.command).toBe(join(dir, 'npx'))
    expect(launch.args).toEqual(['-y', '@agentclientprotocol/claude-agent-acp'])
    expect(launch.env.CLAUDE_CODE_EXECUTABLE).toBe(join(dir, 'claude'))
    expect(launch.unset).toContain('ANTHROPIC_API_KEY')
  })

  it('points Codex ACP adapter at user codex via CODEX_PATH', () => {
    const dir = binDir('codex', ['codex', 'npx'])
    const launch = resolveLaunch('codex', {
      pathDirs: [dir],
      env: { PATH: dir, HOME: dir },
    })
    expect(launch.args).toEqual(['-y', '@agentclientprotocol/codex-acp'])
    expect(launch.env.CODEX_PATH).toBe(join(dir, 'codex'))
    expect(launch.unset).toContain('OPENAI_API_KEY')
    expect(launch.authMethod).toBe('chatgpt')
  })

  it('launches Grok as grok agent --always-approve stdio (flags before stdio)', () => {
    const dir = binDir('grok', ['grok'])
    const launch = resolveLaunch('grok', {
      pathDirs: [dir],
      env: { PATH: dir, HOME: dir },
    })
    expect(launch.command).toBe(join(dir, 'grok'))
    expect(launch.args).toEqual(['agent', '--always-approve', 'stdio'])
  })

  it('honors an explicit cursor command override', () => {
    const dir = binDir('override', ['my-cursor'])
    const launch = resolveLaunch('cursor', {
      override: { command: 'my-cursor', args: ['acp'] },
      pathDirs: [dir],
      env: { PATH: dir, HOME: dir },
    })
    expect(launch.command).toBe(join(dir, 'my-cursor'))
  })

  it('whichOnPath does not pick a missing binary', () => {
    expect(whichOnPath('definitely-not-installed-acp-zzz', ['/tmp'])).toBeUndefined()
  })
})
