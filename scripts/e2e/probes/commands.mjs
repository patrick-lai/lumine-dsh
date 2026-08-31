import { rpc, typert, valueOf } from '../rpc.mjs'

const NEW_COMMANDS = ['review', 'wayfinder', 'pr-warden', 'second-opinion', 'token-saver']
const REQUIRE_NEW_COMMANDS = process.env.DSH_E2E_REQUIRE_NEW_COMMANDS !== '0'

function commandNames(value) {
  const entries = Array.isArray(value)
    ? value
    : Array.isArray(value && value.commands)
      ? value.commands
      : Array.isArray(value && value.items)
        ? value.items
        : []

  return entries
    .map(command => typeof command === 'string' ? command : command && command.name)
    .filter(name => typeof name === 'string')
}

export async function runCommandsProbe() {
  const errors = []
  const listed = valueOf(await rpc('workspace.list', {}))
  const workspaces = listed && listed.items

  if (!listed || listed.__error) {
    errors.push({ step: 'workspace.list', message: 'workspace.list failed before commands probe.', detail: listed })
    return { name: 'commands', ok: false, requireNewCommands: REQUIRE_NEW_COMMANDS, errors }
  }

  const workspaceId = process.env.DSH_E2E_WORKSPACE || (Array.isArray(workspaces) && workspaces[0] && workspaces[0].workspaceId)
  if (!workspaceId) {
    errors.push({
      step: 'workspace.list',
      message: 'No DSH workspace is available; set DSH_E2E_WORKSPACE or open one in dsh web.',
    })
    return { name: 'commands', ok: false, requireNewCommands: REQUIRE_NEW_COMMANDS, errors }
  }

  const created = valueOf(await rpc('session.create', {
    workspaceId,
    agentPreset: 'grok-build',
  }, 120000))
  if (!created || created.__error || !created.sessionId) {
    errors.push({ step: 'session.create', message: 'Could not create the grok-build command probe session.', detail: created })
    return {
      name: 'commands',
      ok: false,
      workspaceId,
      requireNewCommands: REQUIRE_NEW_COMMANDS,
      errors,
    }
  }

  const sessionId = created.sessionId
  const agentId = created.agentId || sessionId
  const commands = valueOf(await typert('commands/list', { agentId }))
  if (!commands || commands.__error) {
    errors.push({ step: 'commands.list', message: 'commands.list failed for the grok-build session.', detail: commands })
  }

  const names = commandNames(commands)
  const required = ['goal', ...(REQUIRE_NEW_COMMANDS ? NEW_COMMANDS : [])]
  for (const name of required) {
    if (!names.includes(name)) {
      errors.push({
        step: 'required-command',
        command: name,
        message: `Required slash command ${name} is not mounted on the live DSH profile.`,
      })
    }
  }

  return {
    name: 'commands',
    ok: errors.length === 0,
    workspaceId,
    sessionId,
    agentId,
    requireNewCommands: REQUIRE_NEW_COMMANDS,
    commands: names,
    errors,
  }
}
