#!/usr/bin/env node
/**
 * Fake official ACP child for CI. Speaks JSON-RPC 2.0 NDJSON on stdio.
 * No live Claude/Codex/Cursor/Grok CLIs required.
 */
import readline from 'node:readline'

const askPermission = process.env.FAKE_ACP_ASK_PERMISSION === '1'
const failMissing = process.env.FAKE_ACP_CRASH === '1'
const noConfigOptions = process.env.FAKE_ACP_NO_CONFIG_OPTIONS === '1'
const rejectSetConfig = process.env.FAKE_ACP_NO_SET_CONFIG === '1'

if (failMissing) {
  console.error('install Claude Code and log in')
  process.exit(2)
}

let sessionId = 'acp-session-1'
const pending = new Map()
let currentModel = 'grok-4.5'
let currentEffort = 'high'

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params })
}

function modelOptions() {
  return [
    { value: 'grok-4.5', name: 'Grok 4.5', description: 'Flagship' },
    { value: 'grok-4', name: 'Grok 4' },
    { value: 'grok-3', name: 'Grok 3' },
  ]
}

function configOptions() {
  return [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: currentModel,
      options: modelOptions(),
    },
    {
      id: 'reasoning_effort',
      name: 'Reasoning',
      category: 'thought_level',
      type: 'select',
      currentValue: currentEffort,
      options: [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
      ],
    },
  ]
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('close', () => {
  process.exit(0)
})
rl.on('line', async (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let msg
  try {
    msg = JSON.parse(trimmed)
  } catch {
    return
  }

  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: 1,
        authMethods: [
          { id: 'cursor_login', name: 'Cursor login' },
          { id: 'chatgpt', name: 'ChatGPT' },
        ],
      },
    })
    return
  }

  if (msg.method === 'authenticate') {
    send({ jsonrpc: '2.0', id: msg.id, result: {} })
    return
  }

  if (msg.method === 'session/new') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        sessionId,
        ...noConfigOptions ? {} : { configOptions: configOptions() },
      },
    })
    return
  }

  if (msg.method === 'session/load') {
    sessionId = msg.params?.sessionId ?? sessionId
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        sessionId,
        ...noConfigOptions ? {} : { configOptions: configOptions() },
      },
    })
    return
  }

  if (msg.method === 'session/set_config_option') {
    if (rejectSetConfig) {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: 'Method not found: session/set_config_option' },
      })
      return
    }
    const configId = msg.params?.configId
    const value = msg.params?.value
    if (configId === 'model' && typeof value === 'string') currentModel = value
    if (configId === 'reasoning_effort' && typeof value === 'string') currentEffort = value
    const options = configOptions()
    notify('session/update', {
      sessionId,
      update: { sessionUpdate: 'config_option_update', configOptions: options },
    })
    send({ jsonrpc: '2.0', id: msg.id, result: { configOptions: options } })
    return
  }

  if (msg.method === 'session/set_model') {
    const value = msg.params?.modelId ?? msg.params?.value
    if (typeof value === 'string') currentModel = value
    send({ jsonrpc: '2.0', id: msg.id, result: { configOptions: configOptions() } })
    return
  }

  if (msg.method === 'session/cancel') {
    return
  }

  if (msg.method === 'session/prompt') {
    const sid = msg.params?.sessionId ?? sessionId
    const promptText = (msg.params?.prompt ?? [])
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n')
    if (/\bping\b/i.test(promptText) || /\bpong\b/i.test(promptText)) {
      notify('session/update', {
        sessionId: sid,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'pong' },
        },
      })
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      return
    }
    notify('session/update', {
      sessionId: sid,
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'thinking...' },
      },
    })
    notify('session/update', {
      sessionId: sid,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hello from ' },
      },
    })
    notify('session/update', {
      sessionId: sid,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'read_file',
        kind: 'read',
        rawInput: { path: 'README.md' },
      },
    })

    if (askPermission) {
      const permId = `perm-${Date.now()}`
      pending.set(permId, msg.id)
      send({
        jsonrpc: '2.0',
        id: permId,
        method: 'session/request_permission',
        params: {
          sessionId: sid,
          toolCall: { toolCallId: 'call-1', title: 'read_file', kind: 'read' },
          options: [
            { optionId: 'allow-always', kind: 'allow_always', name: 'Always' },
            { optionId: 'allow-once', kind: 'allow_once', name: 'Once' },
            { optionId: 'reject-once', kind: 'reject_once', name: 'Reject' },
          ],
        },
      })
      return
    }

    finishPrompt(msg.id, sid)
    return
  }

  if (msg.id !== undefined && (msg.result || msg.error) && pending.has(String(msg.id))) {
    const promptId = pending.get(String(msg.id))
    pending.delete(String(msg.id))
    finishPrompt(promptId, sessionId)
  }
})

function finishPrompt(id, sid) {
  notify('session/update', {
    sessionId: sid,
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-1',
      status: 'completed',
      rawOutput: { ok: true },
    },
  })
  notify('session/update', {
    sessionId: sid,
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'the fake ACP child.' },
    },
  })
  send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } })
}
