import { createRequire } from 'node:module'
import type { RoutineRuntime } from './runtime.ts'
import type { RoutineRule, ScheduleWindow } from './types.ts'
import { RoutineError } from './types.ts'

export const ROUTINE_TOOL_NAMES = [
  'routine_list',
  'routine_create',
  'routine_update',
  'routine_delete',
  'routine_run_now',
] as const

export type RoutineToolName = (typeof ROUTINE_TOOL_NAMES)[number]

export interface ContentBlock {
  type: 'text'
  text: string
}

/**
 * Registry-ready definition. Matches published `@deepseek-ai/dsh-tools`
 * `ToolDefinition`: `output.{ schema, render }` is mandatory, and `execute`
 * returns only the canonical lossless-JSON value (`createSuccessResult`
 * validates it against `output.schema`).
 */
export interface RoutineToolDefinition {
  readonly name: RoutineToolName
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render(args: unknown, value: unknown): ContentBlock[]
    presentationMeta?(args: unknown, value: unknown): unknown
  }
  execute(args: unknown, exec?: unknown): Promise<unknown>
}

export interface ToolsHost {
  tools?: {
    register?: (tool: unknown) => unknown
  }
  logger?: { warn(...args: unknown[]): void }
}

type ValueNode = {
  type: 'string' | 'number' | 'boolean' | 'json' | 'array' | 'object'
  required?: true
  description?: string
  items?: ValueNode
  properties?: Record<string, ValueNode>
  additionalProperties?: boolean
}

type ParamSpec = Record<string, ValueNode>

function renderJson(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function compileValue(node: ValueNode): Record<string, unknown> {
  if (node.type === 'json') return {}
  if (node.type === 'array') {
    return {
      type: 'array',
      ...node.items ? { items: compileValue(node.items) } : {},
    }
  }
  if (node.type === 'object') {
    const inner = compileParams(node.properties ?? {})
    return {
      type: 'object',
      properties: inner.properties,
      ...inner.required ? { required: inner.required } : {},
      additionalProperties: node.additionalProperties ?? false,
    }
  }
  return { type: node.type, ...node.description ? { description: node.description } : {} }
}

function compileParams(spec: ParamSpec): {
  type: 'object'
  properties: Record<string, Record<string, unknown>>
  required?: string[]
} {
  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []
  for (const [key, node] of Object.entries(spec)) {
    properties[key] = compileValue(node)
    if (node.required) required.push(key)
  }
  return {
    type: 'object',
    properties,
    ...required.length > 0 ? { required } : {},
  }
}

function tryOfficialDefineTool(): ((options: Record<string, unknown>) => RoutineToolDefinition) | undefined {
  try {
    const require = createRequire(import.meta.url)
    const mod = require('@deepseek-ai/dsh-tools') as { defineTool?: (options: Record<string, unknown>) => RoutineToolDefinition }
    if (typeof mod.defineTool === 'function') return mod.defineTool.bind(mod)
  } catch {
    // Unit tests and hosts without the published package still emit a full ToolDefinition.
  }
  return undefined
}

/**
 * Build a registry-ready tool. Prefer published `defineTool` when the peer
 * resolves; otherwise emit the same `ToolDefinition` shape it compiles to.
 */
export function defineRoutineTool(options: {
  name: RoutineToolName
  description: string
  parameters: ParamSpec
  output: { schema: ValueNode }
  execute: (args: Record<string, unknown>, exec?: unknown) => Promise<unknown>
}): RoutineToolDefinition {
  const official = tryOfficialDefineTool()
  if (official) {
    return official({
      name: options.name,
      description: options.description,
      parameters: options.parameters,
      output: {
        schema: options.output.schema,
        render: renderJson,
      },
      execute: options.execute,
    })
  }
  return {
    name: options.name,
    description: options.description,
    parameters: compileParams(options.parameters),
    output: {
      schema: compileValue(options.output.schema),
      render: renderJson,
    },
    execute: async (args) => options.execute((args ?? {}) as Record<string, unknown>),
  }
}

function formatError(error: unknown): string {
  if (error instanceof RoutineError) return `${error.code}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}

function fail(code: string, message: string): never {
  throw new RoutineError(message, code)
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asRule(value: unknown): RoutineRule | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return value as RoutineRule
}

const CREATE_PARAMS: ParamSpec = {
  title: { type: 'string', required: true, description: 'Routine title' },
  promptTemplate: { type: 'string', description: 'Prompt template ({{KEY}} / ${KEY})' },
  prompt: { type: 'string' },
  rule: { type: 'json', description: 'once | interval | cron | manual' },
  clock: { type: 'json' },
  timezone: { type: 'string' },
  quietHours: { type: 'json' },
  window: { type: 'json' },
  maxRuns: { type: 'number' },
  parameters: { type: 'json' },
  workspaceCwd: { type: 'string' },
  preset: { type: 'string' },
}

const UPDATE_PARAMS: ParamSpec = {
  id: { type: 'string', required: true },
  title: { type: 'string' },
  promptTemplate: { type: 'string' },
  prompt: { type: 'string' },
  rule: { type: 'json' },
  clock: { type: 'json' },
  timezone: { type: 'string' },
  quietHours: { type: 'json' },
  window: { type: 'json' },
  maxRuns: { type: 'number' },
  parameters: { type: 'json' },
  workspaceCwd: { type: 'string' },
  preset: { type: 'string' },
}

const ID_PARAMS: ParamSpec = {
  id: { type: 'string', required: true },
}

const PAUSED_OUTPUT: ValueNode = {
  type: 'object',
  additionalProperties: false,
  properties: {
    routine: { type: 'json', required: true },
    enabled: { type: 'boolean', required: true },
    saved_paused: { type: 'boolean', required: true },
    operator_must_enable: { type: 'boolean', required: true },
  },
}

function pausedPayload(routine: unknown): {
  routine: unknown
  enabled: false
  saved_paused: true
  operator_must_enable: true
} {
  return { routine, enabled: false, saved_paused: true, operator_must_enable: true }
}

export function createRoutineToolDefinitions(runtime: RoutineRuntime): RoutineToolDefinition[] {
  return [
    defineRoutineTool({
      name: 'routine_list',
      description: 'List persisted DSH routines (clock-driven only).',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { routines: { type: 'array', required: true } },
        },
      },
      execute: async () => ({ routines: runtime.list() }),
    }),
    defineRoutineTool({
      name: 'routine_create',
      description:
        'Create a paused routine. The model cannot arm unattended work; an operator must enable it.',
      parameters: CREATE_PARAMS,
      output: { schema: PAUSED_OUTPUT },
      execute: async (args) => {
        const title = str(args.title)
        const promptTemplate = str(args.promptTemplate) ?? str(args.prompt)
        const rule = asRule(args.rule) ?? asRule(args.clock)
        if (!title || !promptTemplate || !rule) {
          fail('ROUTINE_INVALID', 'title, promptTemplate, and rule (once | interval | cron | manual) are required')
        }
        const created = await runtime.create({
          title,
          promptTemplate,
          rule,
          timezone: str(args.timezone),
          quietHours: args.quietHours as ScheduleWindow | undefined,
          window: args.window as ScheduleWindow | undefined,
          maxRuns: num(args.maxRuns),
          parameters: args.parameters as Record<string, string> | undefined,
          workspaceCwd: str(args.workspaceCwd),
          preset: str(args.preset),
        })
        return pausedPayload(created)
      },
    }),
    defineRoutineTool({
      name: 'routine_update',
      description:
        'Update a routine and leave it paused. The model cannot re-arm unattended work.',
      parameters: UPDATE_PARAMS,
      output: { schema: PAUSED_OUTPUT },
      execute: async (args) => {
        const id = str(args.id)
        if (!id) fail('ROUTINE_INVALID', 'id is required')
        const updated = await runtime.update(id, {
          title: str(args.title),
          promptTemplate: str(args.promptTemplate) ?? str(args.prompt),
          rule: asRule(args.rule) ?? asRule(args.clock),
          timezone: str(args.timezone),
          quietHours: args.quietHours as ScheduleWindow | undefined,
          window: args.window as ScheduleWindow | undefined,
          maxRuns: num(args.maxRuns),
          parameters: args.parameters as Record<string, string> | undefined,
          workspaceCwd: str(args.workspaceCwd),
          preset: str(args.preset),
        })
        return pausedPayload(updated)
      },
    }),
    defineRoutineTool({
      name: 'routine_delete',
      description: 'Delete a persisted routine.',
      parameters: ID_PARAMS,
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { deleted: { type: 'string', required: true } },
        },
      },
      execute: async (args) => {
        const id = str(args.id)
        if (!id) fail('ROUTINE_INVALID', 'id is required')
        await runtime.delete(id)
        return { deleted: id }
      },
    }),
    defineRoutineTool({
      name: 'routine_run_now',
      description:
        'Fire an enabled routine immediately in a new DSH session. Refuses a paused row.',
      parameters: ID_PARAMS,
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { sessionId: { type: 'string' } },
        },
      },
      execute: async (args) => {
        const id = str(args.id)
        if (!id) fail('ROUTINE_INVALID', 'id is required')
        return runtime.runNow(id)
      },
    }),
  ]
}

/** @deprecated Use createRoutineToolDefinitions. Kept for existing unit tests. */
export function createRoutineToolHandlers(runtime: RoutineRuntime): RoutineToolDefinition[] {
  return createRoutineToolDefinitions(runtime)
}

/**
 * Register only routine_list / create / update / delete / run_now.
 * Never register schedule_* and never write schedule/change.
 * `routine_enable` is host RPC / settings only — not a model tool.
 *
 * A `register` throw is contained. Official ToolRuntime.register throws
 * `TypeError: tool "…" must declare output { schema, render, presentationMeta? }`
 * when that contract is missing; that must not fail the plugin constructor
 * (tick / persist / enable still start).
 */
export function registerRoutineTools(host: ToolsHost, runtime: RoutineRuntime): string[] {
  const register = host.tools?.register
  if (typeof register !== 'function') return []
  const names: string[] = []
  for (const tool of createRoutineToolDefinitions(runtime)) {
    try {
      register(tool)
      names.push(tool.name)
    } catch (error) {
      host.logger?.warn?.(
        `lumine-routines: tools.register(${tool.name}) failed: ${formatError(error)}`,
      )
    }
  }
  return names
}
