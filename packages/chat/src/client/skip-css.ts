/**
 * ChatNodeSeat wraps every node in a flow item. Followers render a skip
 * marker; this rule collapses those seats so they take no transcript space.
 * Injected as a real stylesheet. A CSS-module global wrapper would stay in
 * the emitted CSS and the browser would ignore it.
 */
export const SKIP_STYLE_ID = '@lumine/dsh-chat/skip'

export const SKIP_CSS = [
  "[data-chat-flow-kind='tool-call']:has([data-lumine-tool-skip]){",
  'display:none!important;',
  'height:0!important;',
  'margin:0!important;',
  'padding:0!important;',
  'overflow:hidden!important;',
  'border:none!important;',
  '}',
].join('')

export function installSkipStyle(doc: {
  querySelector(sel: string): unknown
  createElement(tag: string): {
    dataset: Record<string, string>
    textContent: string
  }
  head: { appendChild(node: unknown): void }
}): void {
  if (doc.querySelector(`style[data-plugin-css="${SKIP_STYLE_ID}"]`)) return
  const tag = doc.createElement('style')
  tag.dataset.plugin = '@lumine/dsh-chat'
  tag.dataset.pluginCss = SKIP_STYLE_ID
  tag.textContent = SKIP_CSS
  doc.head.appendChild(tag)
}
