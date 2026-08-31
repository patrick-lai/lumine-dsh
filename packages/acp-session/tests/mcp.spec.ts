import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { LEYLINE_MCP_ARGS, LEYLINE_MCP_NAME, leylineMcpServers } from '../src/mcp.ts'

describe('leyline ACP MCP servers', () => {
  it('is empty when leyline is not on PATH', () => {
    expect(leylineMcpServers({ PATH: '/tmp/does-not-exist-leyline-bin' })).toEqual([])
  })

  it('emits a stdio MCP server when leyline is on PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumine-leyline-bin-'))
    const binary = join(dir, 'leyline')
    writeFileSync(binary, '#!/bin/sh\n', { mode: 0o755 })
    mkdirSync(dir, { recursive: true })
    const servers = leylineMcpServers({ PATH: dir })
    expect(servers).toEqual([{
      name: LEYLINE_MCP_NAME,
      command: binary,
      args: [...LEYLINE_MCP_ARGS],
      env: [],
    }])
  })

  it('is what session/new and session/load actually pass', () => {
    const client = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
    expect(client).toMatch(/mcpServers:\s*leylineMcpServers\(\)/)
    expect(client).not.toMatch(/mcpServers:\s*\[\]/)
  })
})
