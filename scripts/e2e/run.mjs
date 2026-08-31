#!/usr/bin/env node

import { BASE, rpc, valueOf } from './rpc.mjs'
import { runAgentsProbe } from './probes/agents.mjs'
import { runRoutinesProbe } from './probes/routines.mjs'
import { runCommandsProbe } from './probes/commands.mjs'
import { runTokenSaverProbe } from './probes/token-saver.mjs'
import { runWorktreeProbe } from './probes/worktree.mjs'

const report = {
  ok: false,
  probes: {},
  errors: [],
}

async function runHealthProbe() {
  const errors = []
  const listed = valueOf(await rpc('workspace.list', {}))
  const items = listed && listed.items
  const workspaceId = process.env.DSH_E2E_WORKSPACE
    || (Array.isArray(items) && items[0] && items[0].workspaceId)

  if (!listed || listed.__error) {
    errors.push({ step: 'workspace.list', message: `DSH health RPC failed at ${BASE}.`, detail: listed })
  } else if (!workspaceId) {
    errors.push({
      step: 'workspace.list',
      message: 'DSH is reachable but no workspace is available; set DSH_E2E_WORKSPACE or open one in dsh web.',
    })
  }

  return {
    name: 'health',
    ok: errors.length === 0,
    base: BASE,
    workspaceId,
    workspaceCount: Array.isArray(items) ? items.length : 0,
    errors,
  }
}

async function runProbe(name, execute) {
  let probe
  try {
    probe = await execute()
  } catch (error) {
    probe = {
      name,
      ok: false,
      errors: [{
        step: 'fatal',
        message: String(error && error.stack ? error.stack : error),
      }],
    }
  }

  report.probes[name] = probe
  for (const error of probe.errors || []) {
    report.errors.push({ probe: name, ...error })
  }
  return probe
}

const health = await runProbe('health', runHealthProbe)
await runProbe('agents', () => runAgentsProbe(health.workspaceId))
await runProbe('routines', runRoutinesProbe)
await runProbe('commands', runCommandsProbe)
await runProbe('token-saver', runTokenSaverProbe)
await runProbe('worktree', () => runWorktreeProbe(health.workspaceId))

report.ok = report.errors.length === 0
console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exitCode = 1
