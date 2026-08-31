import { useEffect, useState, type ReactNode } from 'react'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { MemoryIcon } from './rail-icons.tsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillsKey } from './locales.ts'
import css from './rail.module.css'

interface Rpc {
  call(route: string, endpoint: string, payload: { args: Record<string, unknown> }, signal?: AbortSignal): Promise<unknown>
}

interface MemoryStatus {
  readonly binary: string | null
  readonly mounted: boolean
}

type MemoryState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; value: MemoryStatus }
  | { status: 'error' }

export interface MemoryRailInjected {
  readonly rpc?: Rpc
  readonly t: (key: SkillsKey) => string
}

export type MemoryRailProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'lumine-skills'>
  & InjectFace<MemoryRailInjected>
  & { readonly wide?: boolean }

function unwrap(result: unknown): unknown {
  if (result !== null && typeof result === 'object' && 'ok' in result) {
    const envelope = result as { ok: boolean; value?: unknown }
    if (!envelope.ok) throw new Error('leyline status rpc failed')
    return envelope.value
  }
  return result
}

function memoryStatus(result: unknown): MemoryStatus {
  const value = unwrap(result)
  if (value === null || typeof value !== 'object') throw new Error('invalid leyline status')
  const status = value as { binary?: unknown; mounted?: unknown }
  return {
    binary: typeof status.binary === 'string' ? status.binary : null,
    mounted: status.mounted === true,
  }
}

export function MemoryRailAction(props: MemoryRailProps): ReactNode {
  const { rpc, t, wide } = props
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<MemoryState>({ status: 'idle' })
  const rail = wide === false

  useEffect(() => {
    if (!open) return
    if (!rpc) {
      setState({ status: 'error' })
      return
    }
    let active = true
    setState({ status: 'loading' })
    void rpc.call('/api', 'leyline/status', { args: {} }).then(result => {
      if (active) setState({ status: 'ready', value: memoryStatus(result) })
    }).catch(() => {
      if (active) setState({ status: 'error' })
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
        aria-label={t('navMemory')}
        aria-pressed={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <MemoryIcon />
        {rail ? null : <span className={css.triggerLabel}>{t('navMemory')}</span>}
      </button>
      {open ? (
        <div className={css.overlay} role="presentation">
          <div className={css.mask} onClick={() => { setOpen(false) }} />
          <section className={css.stage} role="dialog" aria-modal="true" aria-label={t('navMemory')}>
            <header className={css.header}>
              <h2 className={css.heading}>{t('navMemory')}</h2>
              <button type="button" className={css.close} onClick={() => { setOpen(false) }}>
                <IconCloseOutline16 />
                <span className={css.hidden}>{t('close')}</span>
              </button>
            </header>
            <div className={css.body} aria-live="polite">
              {state.status === 'idle' || state.status === 'loading' ? (
                <p className={css.loading}>{t('loading')}</p>
              ) : state.status === 'error' ? (
                <p className={css.error}>{t('memoryError')}</p>
              ) : state.value.mounted ? (
                <div className={css.statusRow}>
                  <p className={css.rowTitle}>{t('memoryOnPath')}</p>
                  {state.value.binary === null ? null : <p className={css.meta}>{state.value.binary}</p>}
                </div>
              ) : (
                <div className={css.statusRow}>
                  <p className={css.tertiary}>{t('memoryMissing')}</p>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
