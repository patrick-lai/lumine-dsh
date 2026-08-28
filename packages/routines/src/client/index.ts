/**
 * Routines settings plugin, browser half. Registers a top-level Settings
 * section titled Routines. Enable is host RPC only.
 *
 * Export discipline: type-only imports of other client packages.
 */
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
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
import type { RoutinesSectionInjected } from './section.tsx'
import { RoutinesSettingsStore } from './store.ts'
import { en, zh, type RoutinesKey } from './locales.ts'

export type { RoutinesSectionInjected, RoutinesSectionProps } from './section.tsx'
export type { RoutinesState } from './store.ts'
export type { RoutinesKey } from './locales.ts'
export { cadenceSummary, lastError, rowView } from './view.ts'

const NS = 'settings.routines'

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'lumine-routines: settings dictionaries')

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

  const injected = (): RoutinesSectionInjected => ({
    hooks: { routines: controller.store },
    load: () => controller.load(),
    enable: (id, enabled) => controller.enable(id, enabled),
    runNow: id => controller.runNow(id),
    remove: id => controller.remove(id),
    beginCreate: () => { controller.beginCreate() },
    cancelCreate: () => { controller.cancelCreate() },
    setDraft: patch => { controller.setDraft(patch) },
    confirmCreate: () => controller.confirmCreate(),
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'routines',
    order: 18,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, RoutinesSection))
}
