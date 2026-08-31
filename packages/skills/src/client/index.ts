/** Lumine skill launchers and session context for the DSH web header. */
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import { SkillActions } from './actions.tsx'
import { en, zh } from './locales.ts'
import { MemoryRailAction } from './memory.tsx'
import { WorktreeChip } from './worktree.tsx'
import { WorktreesRailAction } from './worktrees-rail.tsx'

const NS = 'lumine-skills'

interface Rpc {
  call(route: string, endpoint: string, payload: { args: Record<string, unknown> }, signal?: AbortSignal): Promise<unknown>
}

interface ClientContext {
  locale: {
    register(ns: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
    bind(ns: string): (key: string) => string
  }
  slots: {
    inject(name: string, factory: () => unknown): unknown
    register(options: Record<string, unknown>, component: unknown): unknown
  }
  connection?: { rpc?: Rpc }
  effect(fn: () => (() => unknown) | void, label?: string): () => unknown
}

export const inject = ['slots', 'locale', 'connection']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'lumine-skills: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'lumine-actions',
    order: 15,
    locale: NS,
    inject: () => ({ rpc: ctx.connection?.rpc, t }),
  }, SkillActions))

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'lumine-worktree',
    order: 10,
    inject: () => ({ rpc: ctx.connection?.rpc }),
  }, WorktreeChip))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'lumine-worktrees',
    order: 12,
    label: () => t('navWorktrees'),
    locale: NS,
    inject: () => ({ rpc: ctx.connection?.rpc, t }),
  }, WorktreesRailAction))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'lumine-memory',
    order: 14,
    label: () => t('navMemory'),
    locale: NS,
    inject: () => ({ rpc: ctx.connection?.rpc, t }),
  }, MemoryRailAction))
}

export { commandExecuteLine, executeSkillAction, SKILL_ACTIONS, SkillActions } from './actions.tsx'
export { pathFromBound, WorktreeChip } from './worktree.tsx'

export default { inject, apply }
