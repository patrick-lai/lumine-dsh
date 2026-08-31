import { delimiter } from 'node:path'
import { whichOnPath } from './providers.ts'

/** ACP stdio MCP server. `env` is required by McpServerStdio even when empty. */
export interface AcpStdioMcpServer {
  name: string
  command: string
  args: string[]
  env: Array<{ name: string; value: string }>
}

export const LEYLINE_MCP_NAME = 'leyline'
export const LEYLINE_MCP_ARGS = ['serve', '--stdio'] as const

/**
 * ACP `session/new` currently passed `mcpServers: []`, so Claude/Codex/Cursor/Grok
 * children never saw Leyline. When `leyline` is on PATH, hand the official child
 * a stdio MCP server. Missing binary → empty list (session create still works).
 */
export function leylineMcpServers(env: NodeJS.ProcessEnv = process.env): AcpStdioMcpServer[] {
  const pathDirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  const command = whichOnPath('leyline', pathDirs)
  if (!command) return []
  return [{
    name: LEYLINE_MCP_NAME,
    command,
    args: [...LEYLINE_MCP_ARGS],
    env: [],
  }]
}
