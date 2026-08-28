/**
 * Boot-free dump-config compose: later layers win by id, matching
 * `dsh --dump-config` / Include patch merge. Used to prove the host-plane
 * goal-round-driver is not in the mounted set after the lumine overlay.
 */

export interface DumpRow {
  id: string
  name?: string
  disabled?: boolean
}

export type PatchOp =
  | { kind: 'update'; row: DumpRow }
  | { kind: 'insert'; rows: DumpRow[] }

export function parsePatchOps(source: string): PatchOp[] {
  const ops: PatchOp[] = []
  let mode: 'root' | 'insert' = 'root'
  let current: DumpRow | undefined
  let insertRows: DumpRow[] = []

  const flushCurrent = (): void => {
    if (!current?.id) return
    if (mode === 'insert') insertRows.push(current)
    else ops.push({ kind: 'update', row: current })
    current = undefined
  }

  const flushInsert = (): void => {
    if (insertRows.length === 0) return
    ops.push({ kind: 'insert', rows: insertRows })
    insertRows = []
  }

  for (const raw of source.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const indent = (raw.match(/^ */)?.[0].length ?? 0)

    if (indent === 0 && trimmed.startsWith('- insert:')) {
      flushCurrent()
      flushInsert()
      mode = 'insert'
      continue
    }

    if (trimmed.startsWith('- id:')) {
      flushCurrent()
      if (indent === 0) {
        flushInsert()
        mode = 'root'
      } else {
        mode = 'insert'
      }
      current = { id: trimmed.slice('- id:'.length).trim() }
      continue
    }

    if (!current) continue
    if (trimmed.startsWith('name:')) {
      current.name = trimmed.slice('name:'.length).trim().replace(/^['"]|['"]$/g, '')
    }
    if (trimmed.startsWith('disabled:')) {
      current.disabled = trimmed.slice('disabled:'.length).trim() === 'true'
    }
  }

  flushCurrent()
  flushInsert()
  return ops
}

export function composeDump(base: readonly DumpRow[], ...patchSources: string[]): Map<string, DumpRow> {
  const rows = new Map(base.map(row => [row.id, { ...row }]))
  for (const source of patchSources) {
    for (const op of parsePatchOps(source)) {
      const incoming = op.kind === 'insert' ? op.rows : [op.row]
      for (const row of incoming) {
        const prev = rows.get(row.id) ?? { id: row.id }
        rows.set(row.id, { ...prev, ...row })
      }
    }
  }
  return rows
}

export function mountedIds(rows: Map<string, DumpRow>): string[] {
  return [...rows.values()].filter(row => !row.disabled).map(row => row.id)
}

/** Stock dsh-base host rows that matter for the live ACP dump-config probe. */
export const STOCK_DSH_BASE: DumpRow[] = [
  { id: 'agent-loop', name: '@deepseek-ai/dsh-agent-loop' },
  { id: 'goal', name: '@deepseek-ai/dsh-goal' },
  { id: 'goal-round-driver', name: '@deepseek-ai/dsh-goal-round-driver' },
  { id: 'command-goal', name: '@deepseek-ai/dsh-command-goal' },
  { id: 'tool-goal', name: '@deepseek-ai/dsh-tool-goal' },
  { id: 'llm-deepseek', name: '@deepseek-ai/dsh-llm-deepseek' },
]
