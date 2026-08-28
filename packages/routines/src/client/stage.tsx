import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Button, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RoutinesKey } from './locales.ts'
import type { RoutinesState } from './store.ts'
import {
  DEFAULT_OPERATOR_ZONE,
  IANA_ZONES,
  WEEKDAY_LABELS,
  draftReady,
  formatNextRun,
  previewNextRun,
  type CadenceKind,
  type RoutineDraft,
  type RoutineRowView,
} from './view.ts'
import css from './RoutinesPane.module.css'

export interface RoutinesStageProps {
  useRoutines: (selector: (state: RoutinesState) => RoutinesState) => RoutinesState
  t: (key: RoutinesKey) => string
  load: () => Promise<void>
  closePane: () => void
  enable: (id: string, enabled: boolean) => Promise<void>
  runNow: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  select: (id: string) => void
  beginCreate: () => void
  cancelCreate: () => void
  setDraft: (patch: Partial<RoutineDraft>) => void
  confirmSave: () => Promise<void>
}

function RowMeta(props: { row: RoutineRowView; t: RoutinesStageProps['t'] }): ReactNode {
  const next = props.row.nextRunAt === undefined
    ? undefined
    : formatNextRun(props.row.nextRunAt, props.row.timezone)
  const parts = [
    props.row.cadence,
    props.row.enabled ? props.t('on') : props.t('paused'),
    next ? `${props.t('next')} ${next}` : undefined,
  ].filter(Boolean)
  return <p className={css.meta}>{parts.join(' · ')}</p>
}

function toggleDay(current: readonly number[], id: number): number[] {
  return current.includes(id)
    ? current.filter(day => day !== id)
    : [...current, id].sort((a, b) => a - b)
}

function EditorForm(props: {
  draft: RoutineDraft
  creating: boolean
  selectedId: string | null
  selectedEnabled: boolean
  busy: boolean
  t: RoutinesStageProps['t']
  setDraft: RoutinesStageProps['setDraft']
  cancelCreate: () => void
  confirmSave: () => Promise<void>
  enable: RoutinesStageProps['enable']
  runNow: RoutinesStageProps['runNow']
  remove: RoutinesStageProps['remove']
}): ReactNode {
  const kinds: CadenceKind[] = ['once', 'interval', 'cron', 'manual']
  const preview = previewNextRun(props.draft)
  const zone = props.draft.timezone.trim() || DEFAULT_OPERATOR_ZONE
  return (
    <form
      className={css.form}
      onSubmit={event => {
        (event as { preventDefault(): void }).preventDefault()
        void props.confirmSave()
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
        <span className={css.label}>{props.t('when')}</span>
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
      <label className={css.field}>
        <span className={css.label}>{props.t('timezone')}</span>
        <input
          className={css.control}
          list="lumine-routines-zones"
          value={props.draft.timezone}
          onChange={event => props.setDraft({ timezone: event.currentTarget.value })}
        />
        <datalist id="lumine-routines-zones">
          {IANA_ZONES.map(zoneName => (
            <option key={zoneName} value={zoneName} />
          ))}
        </datalist>
      </label>
      <label className={css.check}>
        <input
          type="checkbox"
          checked={props.draft.quietEnabled}
          onChange={event => props.setDraft({ quietEnabled: event.currentTarget.checked })}
        />
        {props.t('quietHours')}
      </label>
      {props.draft.quietEnabled ? (
        <>
          <div className={css.pair}>
            <label className={css.field}>
              <span className={css.label}>{props.t('quietStart')}</span>
              <input
                className={css.control}
                type="time"
                value={props.draft.quietStart}
                onChange={event => props.setDraft({ quietStart: event.currentTarget.value })}
              />
            </label>
            <label className={css.field}>
              <span className={css.label}>{props.t('quietEnd')}</span>
              <input
                className={css.control}
                type="time"
                value={props.draft.quietEnd}
                onChange={event => props.setDraft({ quietEnd: event.currentTarget.value })}
              />
            </label>
          </div>
          <div className={css.field}>
            <span className={css.label}>{props.t('weekdays')}</span>
            <div className={css.days}>
              {WEEKDAY_LABELS.map(day => (
                <button
                  key={day.id}
                  type="button"
                  className={`${css.day}${props.draft.quietWeekdays.includes(day.id) ? ` ${css.on}` : ''}`}
                  aria-pressed={props.draft.quietWeekdays.includes(day.id)}
                  onClick={() => props.setDraft({ quietWeekdays: toggleDay(props.draft.quietWeekdays, day.id) })}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
      <label className={css.field}>
        <span className={css.label}>{props.t('maxRuns')}</span>
        <input
          className={css.control}
          type="number"
          min="1"
          step="1"
          value={props.draft.maxRuns}
          onChange={event => props.setDraft({ maxRuns: event.currentTarget.value })}
        />
      </label>
      {preview === undefined ? null : (
        <p className={css.hint}>{`${props.t('nextIfEnabled')} ${formatNextRun(preview, zone)}`}</p>
      )}
      <p className={css.hint}>{props.creating ? props.t('pausedHint') : props.t('editPauses')}</p>
      <div className={css.formActions}>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={props.busy || !draftReady(props.draft)}
        >
          {props.busy ? props.t('creating') : props.t('save')}
        </Button>
        {props.creating ? (
          <Button type="button" variant="ghost" size="sm" onClick={props.cancelCreate}>
            {props.t('cancel')}
          </Button>
        ) : null}
        {props.selectedId === null ? null : (
          <>
            <Button
              type="button"
              variant={props.selectedEnabled ? 'outline' : 'primary'}
              size="sm"
              disabled={props.busy}
              onClick={() => { void props.enable(props.selectedId!, !props.selectedEnabled) }}
            >
              {props.selectedEnabled ? props.t('pause') : props.t('enable')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={props.busy || !props.selectedEnabled}
              onClick={() => { void props.runNow(props.selectedId!) }}
            >
              {props.t('runNow')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={props.busy}
              onClick={() => { void props.remove(props.selectedId!) }}
            >
              {props.t('delete')}
            </Button>
          </>
        )}
      </div>
    </form>
  )
}

export function RoutinesStage(props: RoutinesStageProps): ReactNode {
  const { useRoutines, t, load, closePane } = props
  const state = useRoutines(snapshot => snapshot)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onKey = (event: { key: string }): void => {
      if (event.key === 'Escape') closePane()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [closePane])

  const selected = state.rows.find(row => row.id === state.selectedId)

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} onClick={() => { closePane() }} />
      <section className={css.stage} role="dialog" aria-label={t('nav')}>
        <header className={css.header}>
          <h2 className={css.heading}>{t('nav')}</h2>
          <button type="button" className={css.close} onClick={() => { closePane() }}>
            <IconCloseOutline16 />
            <span className={css.hidden}>{t('close')}</span>
          </button>
        </header>
        {state.error === null ? null : <p className={css.error}>{state.error}</p>}
        <div className={css.body}>
          <div className={css.listCol}>
            <div className={css.listToolbar}>
              <Button variant="primary" size="sm" onClick={props.beginCreate}>
                {t('create')}
              </Button>
            </div>
            {state.status === 'error' && state.rows.length === 0 ? (
              <Button variant="outline" size="sm" onClick={() => { void load() }}>
                {t('retry')}
              </Button>
            ) : null}
            {state.rows.length === 0 && !state.creating ? (
              <p className={css.empty}>{t('empty')}</p>
            ) : (
              <ul className={css.list}>
                {state.rows.map(row => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={`${css.row}${state.selectedId === row.id && !state.creating ? ` ${css.active}` : ''}`}
                      onClick={() => { props.select(row.id) }}
                    >
                      <p className={css.rowTitle}>{row.title}</p>
                      <RowMeta row={row} t={t} />
                      {row.lastError === undefined ? null : (
                        <p className={css.fault}>{`${t('error')} ${row.lastError}`}</p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={css.editor}>
            {state.draft === null ? (
              <p className={css.placeholder}>{t('empty')}</p>
            ) : (
              <EditorForm
                draft={state.draft}
                creating={state.creating}
                selectedId={state.selectedId}
                selectedEnabled={selected?.enabled === true}
                busy={state.busyId !== null}
                t={t}
                setDraft={props.setDraft}
                cancelCreate={props.cancelCreate}
                confirmSave={props.confirmSave}
                enable={props.enable}
                runNow={props.runNow}
                remove={props.remove}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
