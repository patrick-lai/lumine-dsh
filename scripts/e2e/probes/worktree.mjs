import { rpc, valueOf } from '../rpc.mjs'

function lastWorktree(events) {
  const rows = Array.isArray(events) ? events : []
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const entry = rows[index]
    const event = entry && (entry.event || entry)
    if (!event || (event.type !== 'request/context' && event.type !== 'lumine-acp/bound')) continue
    const data = event.data || {}
    if (typeof data.worktreePath === 'string' && data.worktreePath.startsWith('/')) return data.worktreePath
  }
  return undefined
}

export async function runWorktreeProbe(workspaceId) {
  const errors = []
  if (!workspaceId) {
    errors.push({ step: 'workspace', message: 'no workspace for worktree probe' })
    return { name: 'worktree', ok: false, errors }
  }

  const created = valueOf(await rpc('session.create', {
    workspaceId,
    agentPreset: 'grok-build',
  }, 120000))
  if (!created || created.__error || !created.sessionId) {
    errors.push({ step: 'session.create', detail: created })
    return { name: 'worktree', ok: false, errors }
  }

  const history = valueOf(await rpc('session.history', { sessionId: created.sessionId, maxMessages: 40 }, 20000))
  const events = history && (history.events || history.items || history)
  const worktreePath = lastWorktree(events)

  if (!worktreePath) {
    errors.push({
      step: 'worktreePath',
      message: 'session history has no request/context worktreePath; pooling may be mode=never or cwd is not git',
      sessionId: created.sessionId,
    })
  } else if (!worktreePath.includes('worktrees')) {
    errors.push({
      step: 'pool',
      message: `worktreePath is not under a pooled worktrees leaf: ${worktreePath}`,
    })
  }

  return {
    name: 'worktree',
    ok: errors.length === 0,
    sessionId: created.sessionId,
    worktreePath,
    errors,
  }
}
