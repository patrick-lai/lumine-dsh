import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RoutinesKey } from './locales.ts'
import type { RoutinesState } from './store.ts'
import { draftReady, formatNextRun, type CadenceKind, type CreateDraft, type RoutineRowView } from './view.ts'
import css from './RoutinesSection.module.css'

export interface RoutinesSectionInjected {
  hooks: {
    routines: {
      getSnapshot(): RoutinesState
      subscribe(listener: () => void): () => void
    }
  }
  load: () => Promise<void>
  enable: (id: string, enabled: boolean) => Promise<void>
  runNow: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  beginCreate: () => void
  cancelCreate: () => void
  setDraft: (patch: Partial<CreateDraft>) => void
  confirmCreate: () => Promise<void>
}

export type RoutinesSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.routines'>
  & InjectFace<RoutinesSectionInjected>
  & {
    useRoutines: (selector: (state: RoutinesState) => RoutinesState) => RoutinesState
    t: (key: RoutinesKey) => string
  }

function RowMeta(props: {
  row: RoutineRowView
  t: RoutinesSectionProps['t']
}): ReactNode {
  const next = props.row.nextRunAt === undefined ? undefined : formatNextRun(props.row.nextRunAt)
  const parts = [
    props.row.cadence,
    props.row.enabled ? props.t('on') : props.t('paused'),
    next ? `${props.t('next')} ${next}` : undefined,
  ].filter(Boolean)
  return <p className={css.meta}>{parts.join(' · ')}</p>
}

function CreateForm(props: {
  draft: CreateDraft
  busy: boolean
  t: RoutinesSectionProps['t']
  setDraft: RoutinesSectionInjected['setDraft']
  cancelCreate: () => void
  confirmCreate: () => Promise<void>
}): ReactNode {
  const kinds: CadenceKind[] = ['once', 'interval', 'cron', 'manual']
  return (
    <form
      className={css.form}
      onSubmit={event => {
        (event as { preventDefault(): void }).preventDefault()
        void props.confirmCreate()
      }}
    >
      <label className={css.field}>
        <span className={css.label}>{props.t('title')}</span>
        <input
          className={css.control}
          value={props.draft.title}
          onChange={event => props.setDraft({ title: event.currentTarget.value })}
        />
      </label>
      <label className={css.field}>
        <span className={css.label}>{props.t('prompt')}</span>
        <textarea
          className={css.area}
          value={props.draft.prompt}
          onChange={event => props.setDraft({ prompt: event.currentTarget.value })}
        />
      </label>
      <label className={css.field}>
        <span className={css.label}>{props.t('cadence')}</span>
        <select
          className={css.select}
          value={props.draft.kind}
          onChange={event => props.setDraft({ kind: event.currentTarget.value as CadenceKind })}
        >
          {kinds.map(kind => (
            <option key={kind} value={kind}>{props.t(kind)}</option>
          ))}
        </select>
      </label>
      {props.draft.kind === 'once' ? (
        <label className={css.field}>
          <span className={css.label}>{props.t('at')}</span>
          <input
            className={css.control}
            type="datetime-local"
            value={props.draft.at}
            onChange={event => props.setDraft({ at: event.currentTarget.value })}
          />
        </label>
      ) : null}
      {props.draft.kind === 'interval' ? (
        <label className={css.field}>
          <span className={css.label}>{props.t('seconds')}</span>
          <input
            className={css.control}
            type="number"
            min="1"
            step="1"
            value={props.draft.seconds}
            onChange={event => props.setDraft({ seconds: event.currentTarget.value })}
          />
        </label>
      ) : null}
      {props.draft.kind === 'cron' ? (
        <label className={css.field}>
          <span className={css.label}>{props.t('expression')}</span>
          <input
            className={css.control}
            value={props.draft.cron}
            onChange={event => props.setDraft({ cron: event.currentTarget.value })}
          />
        </label>
      ) : null}
      <p className={css.hint}>{props.t('pausedHint')}</p>
      <div className={css.formActions}>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={props.busy || !draftReady(props.draft)}
        >
          {props.busy ? props.t('creating') : props.t('save')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={props.cancelCreate}>
          {props.t('cancel')}
        </Button>
      </div>
    </form>
  )
}

export function RoutinesSection(props: RoutinesSectionProps): ReactNode {
  const { useRoutines, t, load } = props
  const state = useRoutines(snapshot => snapshot)

  useEffect(() => {
    void load()
  }, [load])

  if (state.status === 'error' && state.rows.length === 0) {
    return (
      <section className={css.section}>
        <h2 className={css.heading}>{t('nav')}</h2>
        <p className={css.error}>{state.error ?? t('error')}</p>
        <Button variant="outline" size="sm" onClick={() => { void load() }}>
          {t('retry')}
        </Button>
      </section>
    )
  }

  return (
    <section className={css.section}>
      <div className={css.toolbar}>
        <h2 className={css.heading}>{t('nav')}</h2>
        {state.creating ? null : (
          <Button variant="primary" size="sm" onClick={props.beginCreate}>
            {t('create')}
          </Button>
        )}
      </div>
      {state.error === null ? null : <p className={css.error}>{state.error}</p>}
      {state.rows.length === 0 && !state.creating ? (
        <p className={css.empty}>{t('empty')}</p>
      ) : (
        <ul className={css.list}>
          {state.rows.map(row => (
            <li key={row.id} className={css.row}>
              <div className={css.identity}>
                <p className={css.title}>{row.title}</p>
                <RowMeta row={row} t={t} />
                {row.lastError === undefined ? null : (
                  <p className={css.fault}>{`${t('error')} ${row.lastError}`}</p>
                )}
              </div>
              <div className={css.actions}>
                <Button
                  variant={row.enabled ? 'outline' : 'primary'}
                  size="sm"
                  disabled={state.busyId === row.id}
                  onClick={() => { void props.enable(row.id, !row.enabled) }}
                >
                  {row.enabled ? t('pause') : t('enable')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={state.busyId === row.id || !row.enabled}
                  onClick={() => { void props.runNow(row.id) }}
                >
                  {t('runNow')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={state.busyId === row.id}
                  onClick={() => { void props.remove(row.id) }}
                >
                  {t('delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {state.draft === null ? null : (
        <CreateForm
          draft={state.draft}
          busy={state.busyId === 'create'}
          t={t}
          setDraft={props.setDraft}
          cancelCreate={props.cancelCreate}
          confirmCreate={props.confirmCreate}
        />
      )}
    </section>
  )
}
