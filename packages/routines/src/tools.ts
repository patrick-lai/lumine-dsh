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

export interface ToolExecuteResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export interface RoutineToolHandler {
  name: RoutineToolName
  description: string
  inputSchema: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<ToolExecuteResult>
}

function ok(payload: unknown): ToolExecuteResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

function fail(message: string): ToolExecuteResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function formatError(error: unknown): string {
  if (error instanceof RoutineError) return `${error.code}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
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

export function createRoutineToolHandlers(runtime: RoutineRuntime): RoutineToolHandler[] {
  return [
    {
      name: 'routine_list',
      description: 'List persisted DSH routines (clock-driven only).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => ok({ routines: runtime.list() }),
    },
    {
      name: 'routine_create',
      description:
        'Create a paused routine. The model cannot arm unattended work; an operator must enable it.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          promptTemplate: { type: 'string' },
          prompt: { type: 'string' },
          rule: { type: 'object' },
          clock: { type: 'object' },
          timezone: { type: 'string' },
          quietHours: { type: 'object' },
          window: { type: 'object' },
          maxRuns: { type: 'number' },
          parameters: { type: 'object' },
          workspaceCwd: { type: 'string' },
          preset: { type: 'string' },
        },
        required: ['title'],
        additionalProperties: false,
      },
      execute: async (args) => {
        try {
          const title = str(args.title)
          const promptTemplate = str(args.promptTemplate) ?? str(args.prompt)
          const rule = asRule(args.rule) ?? asRule(args.clock)
          if (!title || !promptTemplate || !rule) {
            return fail('title, promptTemplate, and rule (once | interval | cron | manual) are required')
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
          return ok({ routine: created, enabled: false })
        } catch (error) {
          return fail(formatError(error))
        }
      },
    },
    {
      name: 'routine_update',
      description:
        'Update a routine and leave it paused. The model cannot re-arm unattended work.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          promptTemplate: { type: 'string' },
          prompt: { type: 'string' },
          rule: { type: 'object' },
          clock: { type: 'object' },
          timezone: { type: 'string' },
          quietHours: { type: 'object' },
          window: { type: 'object' },
          maxRuns: { type: 'number' },
          parameters: { type: 'object' },
          workspaceCwd: { type: 'string' },
          preset: { type: 'string' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      execute: async (args) => {
        try {
          const id = str(args.id)
          if (!id) return fail('id is required')
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
          return ok({ routine: updated, enabled: false })
        } catch (error) {
          return fail(formatError(error))
        }
      },
    },
    {
      name: 'routine_delete',
      description: 'Delete a persisted routine.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      execute: async (args) => {
        try {
          const id = str(args.id)
          if (!id) return fail('id is required')
          await runtime.delete(id)
          return ok({ deleted: id })
        } catch (error) {
          return fail(formatError(error))
        }
      },
    },
    {
      name: 'routine_run_now',
      description:
        'Fire an enabled routine immediately in a new DSH session. Refuses a paused row.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      execute: async (args) => {
        try {
          const id = str(args.id)
          if (!id) return fail('id is required')
          const result = await runtime.runNow(id)
          return ok(result)
        } catch (error) {
          return fail(formatError(error))
        }
      },
    },
  ]
}

export interface ToolsHost {
  tools?: {
    register?: (tool: unknown) => unknown
  }
}

/**
 * Register only routine_list / create / update / delete / run_now.
 * Never register schedule_* and never write schedule/change.
 * `routine_enable` is host RPC / settings only — not a model tool.
 */
export function registerRoutineTools(host: ToolsHost, runtime: RoutineRuntime): string[] {
  const register = host.tools?.register
  if (typeof register !== 'function') return []
  const names: string[] = []
  for (const handler of createRoutineToolHandlers(runtime)) {
    register(wrapTool(handler))
    names.push(handler.name)
  }
  return names
}

function wrapTool(handler: RoutineToolHandler): unknown {
  return {
    name: handler.name,
    description: handler.description,
    inputSchema: handler.inputSchema,
    execute: handler.execute,
  }
}
