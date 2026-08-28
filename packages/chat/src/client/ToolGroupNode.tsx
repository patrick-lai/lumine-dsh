import { useState } from 'react'
import {
  argsRawOf,
  callIdOf,
  callName,
  collectRun,
  resultText,
  subCallsOf,
  toolViewOwner,
  type ChatNodeLike,
  type ToolCallBlockLike,
  type ToolMember,
} from './group.ts'
import { faceSnapshot, memberLine } from './face.ts'
import type { ChatKey } from './locales.ts'
import css from './ToolGroup.module.css'

interface ChatSnapshotLike {
  readonly chat: {
    readonly order: readonly string[]
    readonly nodes: { get(key: string): ChatNodeLike | undefined }
  }
}

interface ToolCallNode {
  readonly key: string
  readonly kind: string
  readonly data: { readonly root: ToolMember['block'] }
}

interface ToolGroupNodeProps {
  readonly node: ToolCallNode
  readonly cwd?: string
  readonly openFile?: (path: string) => void
  readonly inspectCall?: (callId: string) => void
  readonly selectedCallId?: string
  readonly renderSlot?: (
    name: string,
    owner: Record<string, unknown>,
    options?: { entryKey?: string; fallback?: unknown },
  ) => unknown
  readonly useSession?: <T>(selector: (snapshot: ChatSnapshotLike) => T) => T
  readonly t: (key: ChatKey | string) => string
}

type ToolHost = Pick<ToolGroupNodeProps, 'cwd' | 'openFile' | 'inspectCall' | 'selectedCallId' | 'renderSlot' | 't'>

function Skip(): unknown {
  return <div className={css.skip} data-lumine-tool-skip="" hidden />
}

function payloadPreview(block: ToolCallBlockLike): string {
  const raw = argsRawOf(block).trim()
  if (!raw || raw === '{}') return ''
  return raw.length > 800 ? `${raw.slice(0, 800)}…` : raw
}

function FallbackToolCard({
  block,
  t,
}: {
  block: ToolCallBlockLike
  t: (key: ChatKey | string) => string
}): unknown {
  const line = memberLine({
    key: callIdOf(block),
    callId: callIdOf(block),
    toolName: callName(block) || 'tool',
    block,
  })
  const args = payloadPreview(block)
  const result = resultText(block)
  const stateKey: ChatKey = line.state === 'running' ? 'running' : line.state === 'failed' ? 'failed' : 'completed'
  return (
    <div className={css.member}>
      <div className={css.memberHead}>
        <span className={css.srOnly}>{t(stateKey)}</span>
        <span className={`${css.dot} ${css[line.state] ?? ''}`} aria-hidden="true" />
        <span className={css.verb}>{line.verb}</span>
        {line.target ? <span className={css.target}>{line.target}</span> : null}
      </div>
      {args ? <pre className={css.payload}>{args}</pre> : null}
      {result ? (
        <pre className={css.payload} data-error={line.state === 'failed' || undefined}>{result}</pre>
      ) : null}
    </div>
  )
}

function ToolCallView({
  block,
  cwd,
  openFile,
  inspectCall,
  selectedCallId,
  renderSlot,
  t,
}: ToolHost & { block: ToolCallBlockLike }): unknown {
  const callId = callIdOf(block)
  const toolName = callName(block) || 'tool'
  const owner = toolViewOwner(block, { cwd, openFile, inspectCall })
  const fallback = <FallbackToolCard block={block} t={t} />
  const children = subCallsOf(block)
  const body = renderSlot
    ? renderSlot('tool.call.toolview', owner, { entryKey: toolName, fallback })
    : fallback
  return (
    <div
      className={css.callRow}
      data-chat-anchor-key={`call:${callId}`}
      data-chat-call-id={callId}
      data-selected={selectedCallId === callId || undefined}
    >
      {body as never}
      {children.length > 0 ? (
        <div className={css.subCalls} data-subcalls="">
          {children.map(child => (
            <ToolCallView
              key={callIdOf(child)}
              block={child}
              cwd={cwd}
              openFile={openFile}
              inspectCall={inspectCall}
              selectedCallId={selectedCallId}
              renderSlot={renderSlot}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ActivityStrip({
  members,
  cwd,
  openFile,
  inspectCall,
  selectedCallId,
  renderSlot,
  t,
}: ToolHost & { members: readonly ToolMember[] }): unknown {
  const [open, setOpen] = useState(false)
  const face = faceSnapshot(members)
  const summary = face.working
    ? [face.verb, face.target].filter(Boolean).join(' ')
    : face.summary
  const badgeClass = `${css.badge} ${css[face.outcome] ?? ''}`
  const outcomeKey: ChatKey = face.working
    ? 'working'
    : face.outcome === 'failed'
      ? 'failed'
      : face.outcome === 'mixed'
        ? 'mixed'
        : 'succeeded'
  const failedLabel = t('failedCount').replace('{n}', String(face.failed))

  return (
    <div className={css.group} data-lumine-tool-group="" data-outcome={face.outcome}>
      <button
        type="button"
        className={css.header}
        onClick={() => { setOpen(value => !value) }}
        aria-expanded={open}
      >
        <span className={css.srOnly}>{t(outcomeKey)}</span>
        <span className={badgeClass} aria-hidden="true">
          {face.working
            ? <span className={css.spin} />
            : face.outcome === 'failed' ? '×' : '✓'}
        </span>
        <span className={css.count}>{face.count}</span>
        <span className={css.actions}>{t('actions')}</span>
        <span className={`${css.summary} ${face.working ? css.working : ''}`}>
          {face.working ? t('working') : '· '}
          {summary}
        </span>
        {face.failed > 0
          ? <span className={css.failNote} aria-label={failedLabel}>{face.failed}</span>
          : null}
        {face.recovered > 0
          ? <span className={css.retryNote}>{t('retried')} {face.recovered}</span>
          : null}
        <span className={css.chevron} aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className={css.table}>
          {members.map(member => (
            <ToolCallView
              key={member.key}
              block={member.block}
              cwd={cwd}
              openFile={openFile}
              inspectCall={inspectCall}
              selectedCallId={selectedCallId}
              renderSlot={renderSlot}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function ToolGroupNode({
  node,
  cwd,
  openFile,
  inspectCall,
  selectedCallId,
  renderSlot,
  useSession,
  t,
}: ToolGroupNodeProps): unknown {
  const nodeKey = node.key
  const run = useSession
    ? useSession(snapshot => collectRun(snapshot.chat.order, snapshot.chat.nodes, nodeKey))
    : { role: 'solo' as const, members: memberFromSelf(node) }

  const members = run.members.length > 0 ? run.members : memberFromSelf(node)
  const host: ToolHost = { cwd, openFile, inspectCall, selectedCallId, renderSlot, t }

  if (run.role === 'follower') return Skip()
  if (run.role === 'leader') return <ActivityStrip members={members} {...host} />

  const solo = members[0]
  if (!solo) return Skip()
  return (
    <div className={css.slot}>
      <ToolCallView block={solo.block} {...host} />
    </div>
  )
}

function memberFromSelf(node: ToolCallNode): ToolMember[] {
  const block = node.data.root
  return [{
    key: node.key,
    callId: callIdOf(block),
    toolName: callName(block) || 'tool',
    block,
  }]
}

