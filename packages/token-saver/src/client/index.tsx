import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { ReactNode } from 'react'
import { Dial, type TokenSaverRpc } from './dial.tsx'

const NS = 'token-saver'

interface TokenSaverSectionProps {
  rpc?: TokenSaverRpc
}

export function TokenSaverSection(props: TokenSaverSectionProps): ReactNode {
  return <section><Dial rpc={props.rpc} /></section>
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
  connection?: { rpc?: TokenSaverRpc }
  effect(fn: () => (() => unknown) | void, label?: string): () => unknown
}

export const inject = ['slots', 'locale', 'connection']

const en = {
  title: 'Token Saver',
}
const zh = {
  title: 'Token Saver',
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'lumine-token-saver: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'token-saver',
    order: 15,
    label: () => t('title'),
    locale: NS,
    inject: () => ({ rpc: ctx.connection?.rpc }),
  }, Dial))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'token-saver',
    order: 19,
    label: () => t('title'),
    locale: NS,
    inject: () => ({ rpc: ctx.connection?.rpc }),
  }, TokenSaverSection))
}

export default { inject, apply }
