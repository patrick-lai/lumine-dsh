/**
 * Routines client. Left-rail footer action opens the list+editor pane.
 * Settings keeps a thin deep-link only.
 *
 * Export discipline: type-only imports of other client packages.
 */
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { RoutinesRailAction } from './rail.tsx'
import { RoutinesSection } from './section.tsx'

interface ClientContext {
  locale: {
    register(ns: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
    bind(ns: string): (key: string) => string
  }
  slots: {
    inject(name: string, factory: () => unknown): unknown
    register(options: Record<string, unknown>, component: unknown): unknown
  }
  connection: {
    rpc: {
      call(route: string, endpoint: string, payload: { args: Record<string, unknown> }, signal?: AbortSignal): Promise<unknown>
    }
  }
  remote: {
    $on(event: string, listener: (...args: unknown[]) => unknown): () => void
  }
  effect(fn: () => (() => unknown) | void, label?: string): () => void
  on(event: string, listener: (...args: unknown[]) => unknown): () => void
}

import type { RoutinesRailInjected } from './rail.tsx'
import type { RoutinesSectionInjected } from './section.tsx'
import { RoutinesSettingsStore } from './store.ts'
import { en, zh, type RoutinesKey } from './locales.ts'

export type { RoutinesSectionInjected, RoutinesSectionProps } from './section.tsx'
export type { RoutinesRailInjected, RoutinesRailProps } from './rail.tsx'
export type { RoutinesState } from './store.ts'
export type { RoutinesKey } from './locales.ts'
export {
  cadenceSummary, lastError, rowView, emptyDraft, draftFromRoutine,
  toCreateInput, previewNextRun, DEFAULT_OPERATOR_ZONE,
} from './view.ts'

const NS = 'routines'

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'lumine-routines: dictionaries')
  ctx.effect(() => ctx.locale.register('settings.routines', { zh, en }), 'lumine-routines: settings dictionaries')

  const t = ctx.locale.bind(NS) as (key: RoutinesKey) => string
  const controller = new RoutinesSettingsStore(ctx.connection.rpc)

  ctx.effect(() => {
    const refresh = (): void => {
      if (controller.store.getSnapshot().status === 'idle') return
      void controller.load()
    }
    const disposers = [
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'lumine-routines: connection refresh')

  const railInjected = (): RoutinesRailInjected => ({
    hooks: { routines: controller.store },
    togglePane: () => { controller.togglePane() },
    closePane: () => { controller.closePane() },
    load: () => controller.load(),
    enable: (id, enabled) => controller.enable(id, enabled),
    runNow: id => controller.runNow(id),
    remove: id => controller.remove(id),
    select: id => { controller.select(id) },
    beginCreate: () => { controller.beginCreate() },
    cancelCreate: () => { controller.cancelCreate() },
    setDraft: patch => { controller.setDraft(patch) },
    confirmSave: () => controller.confirmSave(),
  })

  const settingsInjected = (): RoutinesSectionInjected => ({
    openPane: () => { controller.openPane() },
  })

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'routines',
    order: 18,
    label: () => t('nav'),
    locale: NS,
    inject: railInjected,
  }, RoutinesRailAction))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'routines',
    order: 18,
    label: () => t('nav'),
    locale: 'settings.routines',
    inject: settingsInjected,
  }, RoutinesSection))
}
