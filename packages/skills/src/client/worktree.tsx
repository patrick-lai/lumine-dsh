import { useEffect, useState, type ReactNode } from 'react'
import css from './header.module.css'

interface Rpc {
  call(route: string, endpoint: string, payload: { args: Record<string, unknown> }, signal?: AbortSignal): Promise<unknown>
}

interface SessionSnapshotLike {
  readonly running?: boolean
  readonly nodes?: { readonly length: number }
}

interface WorktreeChipProps {
  readonly sessionId?: string
  readonly rpc?: Rpc
  readonly useSession?: <T>(selector: (snapshot: SessionSnapshotLike) => T) => T
}

function unwrapBound(result: unknown): unknown {
  if (result !== null && typeof result === 'object' && 'ok' in result) {
    const envelope = result as { ok: boolean; value?: unknown }
    if (!envelope.ok) throw new Error('worktree bound rpc failed')
    return envelope.value
  }
  return result
}

export function pathFromBound(result: unknown): string {
  const value = unwrapBound(result)
  if (value !== null && typeof value === 'object') {
    const path = (value as { path?: unknown }).path
    if (typeof path === 'string' && path.startsWith('/')) return path
  }
  return 'main'
}

function pathLabel(path: string): string {
  const segments = path.split(/[\\/]+/).filter(Boolean)
  if (segments.length >= 2) return `${segments.at(-2)}/${segments.at(-1)}`
  return segments.at(-1) ?? path
}

export function WorktreeChip({ sessionId, rpc, useSession }: WorktreeChipProps): ReactNode {
  const [path, setPath] = useState('main')
  const running = useSession?.(snapshot => snapshot.running)
  const nodeCount = useSession?.(snapshot => snapshot.nodes?.length)

  useEffect(() => {
    if (!rpc || !sessionId) {
      setPath('main')
      return
    }
    let active = true
    void rpc.call('/api', 'worktree/bound', { args: { sessionId } }).then(result => {
      if (active) setPath(pathFromBound(result))
    }).catch(() => {
      if (active) setPath('main')
    })
    return () => { active = false }
  }, [rpc, sessionId, running, nodeCount])

  return <span className={css.worktree} title={path}>{pathLabel(path)}</span>
}
