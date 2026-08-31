import { useEffect, useState, type ReactNode } from 'react'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { WorktreesIcon } from './rail-icons.tsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillsKey } from './locales.ts'
import css from './rail.module.css'

interface Rpc {
  call(route: string, endpoint: string, payload: { args: Record<string, unknown> }, signal?: AbortSignal): Promise<unknown>
}

interface WorktreeRow {
  readonly path: string
  readonly busy: boolean
}

type WorktreesState =
  | { status: 'idle' | 'loading'; rows: readonly WorktreeRow[] }
  | { status: 'ready'; rows: readonly WorktreeRow[] }
  | { status: 'error'; rows: readonly WorktreeRow[] }

export interface WorktreesRailInjected {
  readonly rpc?: Rpc
  readonly t: (key: SkillsKey) => string
}

export type WorktreesRailProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'lumine-skills'>
  & InjectFace<WorktreesRailInjected>
  & { readonly wide?: boolean }

function unwrap(result: unknown): unknown {
  if (result !== null && typeof result === 'object' && 'ok' in result) {
    const envelope = result as { ok: boolean; value?: unknown }
    if (!envelope.ok) throw new Error('worktree list rpc failed')
    return envelope.value
  }
  return result
}

function rowsFrom(result: unknown): WorktreeRow[] {
  const value = unwrap(result)
  if (value === null || typeof value !== 'object') throw new Error('invalid worktree list')
  const trees = (value as { trees?: unknown }).trees
  if (!Array.isArray(trees)) throw new Error('invalid worktree rows')
  return trees.flatMap(row => {
    if (row === null || typeof row !== 'object') return []
    const tree = row as { path?: unknown; busy?: unknown }
    if (typeof tree.path !== 'string' || tree.path.length === 0) return []
    return [{ path: tree.path, busy: tree.busy === true }]
  })
}

function pathLabel(path: string): string {
  const segments = path.split(/[\\/]+/).filter(Boolean)
  if (segments.length >= 2) return `${segments.at(-2)}/${segments.at(-1)}`
  return segments.at(-1) ?? path
}

export function WorktreesRailAction(props: WorktreesRailProps): ReactNode {
  const { rpc, t, wide } = props
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<WorktreesState>({ status: 'idle', rows: [] })
  const rail = wide === false

  useEffect(() => {
    if (!open) return
    if (!rpc) {
      setState({ status: 'error', rows: [] })
      return
    }
    let active = true
    setState({ status: 'loading', rows: [] })
    void rpc.call('/api', 'worktree/list', { args: {} }).then(result => {
      if (active) setState({ status: 'ready', rows: rowsFrom(result) })
    }).catch(() => {
      if (active) setState({ status: 'error', rows: [] })
    })
    return () => { active = false }
  }, [open, rpc])

  useEffect(() => {
    if (!open) return
    const onKey = (event: { key: string }): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        className={`${css.trigger}${rail ? ` ${css.rail}` : ''}${open ? ` ${css.active}` : ''}`}
        aria-label={t('navWorktrees')}
        aria-pressed={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <WorktreesIcon />
        {rail ? null : <span className={css.triggerLabel}>{t('navWorktrees')}</span>}
      </button>
      {open ? (
        <div className={css.overlay} role="presentation">
          <div className={css.mask} onClick={() => { setOpen(false) }} />
          <section className={css.stage} role="dialog" aria-modal="true" aria-label={t('navWorktrees')}>
            <header className={css.header}>
              <h2 className={css.heading}>{t('navWorktrees')}</h2>
              <button type="button" className={css.close} onClick={() => { setOpen(false) }}>
                <IconCloseOutline16 />
                <span className={css.hidden}>{t('close')}</span>
              </button>
            </header>
            <div className={css.body} aria-live="polite">
              {state.status === 'loading' || state.status === 'idle' ? (
                <p className={css.loading}>{t('loading')}</p>
              ) : state.status === 'error' ? (
                <p className={css.error}>{t('worktreesError')}</p>
              ) : state.rows.length === 0 ? (
                <p className={css.empty}>{t('worktreesEmpty')}</p>
              ) : (
                <ul className={css.list}>
                  {state.rows.map(row => (
                    <li key={row.path} className={css.statusRow} title={row.path}>
                      <p className={css.rowTitle}>{pathLabel(row.path)}</p>
                      <p className={css.meta}>{row.busy ? t('worktreeBusy') : t('worktreeFree')}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
