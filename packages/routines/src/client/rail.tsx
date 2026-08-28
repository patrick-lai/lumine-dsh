import type { ReactNode } from 'react'
import { IconDataOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RoutinesKey } from './locales.ts'
import type { RoutinesState } from './store.ts'
import type { RoutineDraft } from './view.ts'
import { RoutinesStage } from './stage.tsx'
import css from './RoutinesPane.module.css'

export interface RoutinesRailInjected {
  hooks: {
    routines: {
      getSnapshot(): RoutinesState
      subscribe(listener: () => void): () => void
    }
  }
  togglePane: () => void
  closePane: () => void
  load: () => Promise<void>
  enable: (id: string, enabled: boolean) => Promise<void>
  runNow: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  select: (id: string) => void
  beginCreate: () => void
  cancelCreate: () => void
  setDraft: (patch: Partial<RoutineDraft>) => void
  confirmSave: () => Promise<void>
}

export type RoutinesRailProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'routines'>
  & InjectFace<RoutinesRailInjected>
  & {
    useRoutines: (selector: (state: RoutinesState) => RoutinesState) => RoutinesState
    t: (key: RoutinesKey) => string
    wide?: boolean
  }

export function RoutinesRailAction(props: RoutinesRailProps): ReactNode {
  const { useRoutines, t, togglePane, closePane, wide } = props
  const state = useRoutines(snapshot => snapshot)
  const rail = wide === false
  return (
    <>
      <button
        type="button"
        className={`${css.trigger}${rail ? ` ${css.rail}` : ''}${state.open ? ` ${css.active}` : ''}`}
        aria-label={t('nav')}
        aria-pressed={state.open}
        onClick={() => { togglePane() }}
      >
        <IconDataOutline16 />
        {rail ? null : <span className={css.triggerLabel}>{t('nav')}</span>}
      </button>
      {state.open ? (
        <RoutinesStage
          useRoutines={props.useRoutines}
          t={t}
          load={props.load}
          closePane={closePane}
          enable={props.enable}
          runNow={props.runNow}
          remove={props.remove}
          select={props.select}
          beginCreate={props.beginCreate}
          cancelCreate={props.cancelCreate}
          setDraft={props.setDraft}
          confirmSave={props.confirmSave}
        />
      ) : null}
    </>
  )
}
