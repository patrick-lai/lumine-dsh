/**
 * Lumine-style chat transcript for DeepSeek Harness.
 *
 * Replaces the stock `tool-call` chat node so consecutive ACP tool rows fold
 * into one collapsed activity strip (Lumine inbuilt chat), instead of a
 * hundred "Tool call · read_file · …" lines.
 *
 * Export discipline: type-only imports of other client packages.
 */
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import { ToolGroupNode } from './ToolGroupNode.tsx'
import { en, zh } from './locales.ts'
import { installSkipStyle } from './skip-css.ts'

export {
  collectRun, roleInRun, tallyRoles, MINIMUM_GROUP_SIZE,
  walkToolTree, resultText, toolViewOwner, subCallsOf,
} from './group.ts'
export { faceSnapshot, verbFor, toolKind, targetFor, runOutcome } from './face.ts'
export { ToolGroupNode } from './ToolGroupNode.tsx'

const NS = 'lumine-chat'

interface ClientContext {
  locale: {
    register(ns: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
    bind(ns: string): (key: string) => string
  }
  slots: {
    inject(name: string, factory: () => unknown): unknown
    register(options: Record<string, unknown>, component: unknown): unknown
  }
  effect(fn: () => (() => unknown) | void, label?: string): () => void
}

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'lumine-chat: dictionaries')
  ctx.effect(() => {
    if (typeof document !== 'undefined') installSkipStyle(document)
    return () => {}
  }, 'lumine-chat: skip css')

  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'tool-call',
    // Stock ui-tool already owns this key at priority 0 and declared
    // tool.call.toolview. Lowest priority wins; do not redeclare children.
    priority: -1,
    locale: NS,
  }, ToolGroupNode))
}
