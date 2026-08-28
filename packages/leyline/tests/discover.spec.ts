import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { candidateBaseUrls, discoverLeyline, leylineHome, readDaemonJson } from '../src/discover.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Leyline daemon discovery', () => {
  it('orders candidates LEYLINE_BASE_URL → daemon.json → :6868 → :7893', () => {
    const home = mkdtempSync(join(tmpdir(), 'lumine-leyline-home-'))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ base_url: 'http://127.0.0.1:7000' }))
    expect(readDaemonJson(home)).toBe('http://127.0.0.1:7000')
    expect(candidateBaseUrls({
      explicitBaseUrl: 'http://127.0.0.1:6000/',
      env: { LEYLINE_BASE_URL: 'http://10.0.0.2:6868', LEYLINE_HOME: home },
    })).toEqual([
      'http://127.0.0.1:6000',
      'http://10.0.0.2:6868',
      'http://127.0.0.1:7000',
      'http://127.0.0.1:6868',
      'http://127.0.0.1:7893',
    ])
  })

  it('expands LEYLINE_HOME to ~/.leyline by default', () => {
    expect(leylineHome({})).toMatch(/\.leyline$/)
  })

  it('attaches to the first candidate that answers the snapshot probe', async () => {
    const seen: string[] = []
    const found = await discoverLeyline({
      env: {},
      timeoutMs: 200,
      spawnIfMissing: false,
      fetchImpl: async (input) => {
        const url = String(input)
        seen.push(url)
        if (url.startsWith('http://127.0.0.1:7893')) {
          return jsonResponse({ capabilities: { contract: 1, features: { context_pack: 1 } } })
        }
        throw new Error('down')
      },
    })
    expect(found.source).toBe('probe')
    expect(found.baseUrl).toBe('http://127.0.0.1:7893')
    expect(seen.some(url => url.includes(':6868'))).toBe(true)
  })

  it('does not spawn when spawnIfMissing is false', async () => {
    let spawned = false
    const found = await discoverLeyline({
      env: { PATH: '/no-such-bin' },
      timeoutMs: 200,
      spawnIfMissing: false,
      fetchImpl: async () => {
        throw new Error('down')
      },
      spawnImpl: ((..._args: unknown[]) => {
        spawned = true
        return { unref() {} } as never
      }) as typeof import('node:child_process').spawn,
      which: () => '/usr/bin/leyline',
    })
    expect(found.source).toBe('none')
    expect(found.baseUrl).toBeUndefined()
    expect(spawned).toBe(false)
  })

  it('spawns leyline serve --bind 127.0.0.1:6868 when nothing answers', async () => {
    const home = mkdtempSync(join(tmpdir(), 'lumine-leyline-empty-'))
    const args: string[][] = []
    let attempts = 0
    const found = await discoverLeyline({
      env: { PATH: '/usr/bin', LEYLINE_HOME: home },
      timeoutMs: 200,
      spawnIfMissing: true,
      fetchImpl: async (input) => {
        attempts += 1
        if (String(input).startsWith('http://127.0.0.1:6868') && attempts > 3) {
          return jsonResponse({ capabilities: { contract: 1, features: {} } })
        }
        throw new Error('down')
      },
      spawnImpl: ((command: string, argv: string[]) => {
        args.push([command, ...argv])
        return { unref() {} } as never
      }) as typeof import('node:child_process').spawn,
      which: () => '/usr/local/bin/leyline',
    })
    expect(args).toEqual([['/usr/local/bin/leyline', 'serve', '--bind', '127.0.0.1:6868']])
    expect(found.source).toBe('spawn')
    expect(found.baseUrl).toBe('http://127.0.0.1:6868')
  })
})
