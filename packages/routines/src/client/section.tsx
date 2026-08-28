import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RoutinesKey } from './locales.ts'
import css from './RoutinesSection.module.css'

export interface RoutinesSectionInjected {
  openPane: () => void
}

export type RoutinesSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.routines'>
  & InjectFace<RoutinesSectionInjected>
  & {
    t: (key: RoutinesKey) => string
  }

export function RoutinesSection(props: RoutinesSectionProps): ReactNode {
  return (
    <section className={css.section}>
      <h2 className={css.heading}>{props.t('nav')}</h2>
      <p className={css.empty}>{props.t('settingsHint')}</p>
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          props.openPane()
          props.close?.()
        }}
      >
        {props.t('openPane')}
      </Button>
    </section>
  )
}
