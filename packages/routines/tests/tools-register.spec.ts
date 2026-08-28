import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { filePersist } from '../src/persist.ts'
import { RoutineRuntime } from '../src/runtime.ts'
import { RoutineStore } from '../src/store.ts'
import {
  createRoutineToolDefinitions,
  defineRoutineTool,
  registerRoutineTools,
  type RoutineToolDefinition,
} from '../src/tools.ts'
import { snapshotJsonValue } from './snapshot-json.ts'

/**
 * Published `ToolRuntime.register` (packages/core/tools/src/index.ts):
 * throws TypeError unless `output.{ schema, render }` is present.
 */
function officialRegister(definition: Partial<RoutineToolDefinition> & { name: string }): RoutineToolDefinition {
  const output = definition.output
  if (
    output === undefined
    || typeof output !== 'object'
    || typeof output.render !== 'function'
    || (output.presentationMeta !== undefined && typeof output.presentationMeta !== 'function')
  ) {
    throw new TypeError(`tool "${definition.name}" must declare output { schema, render, presentationMeta? }`)
  }
  if (output.schema === undefined || typeof output.schema !== 'object' || output.schema === null) {
    throw new TypeError(`tool "${definition.name}" must declare output { schema, render, presentationMeta? }`)
  }
  return definition as RoutineToolDefinition
}

class ToolOutputError extends Error {
  readonly violations: string[]
  constructor(toolName: string, violations: string[]) {
    super(`tool "${toolName}" returned invalid output: ${violations.join('; ')}`)
    this.name = 'ToolOutputError'
    this.violations = violations
  }
}

function snapshotToolValue(toolName: string, candidate: unknown): unknown {
  const detached = snapshotJsonValue(candidate)
  if (detached === undefined) throw new ToolOutputError(toolName, ['value is not lossless JSON'])
  return detached
}

function validateAgainstSchema(schema: Record<string, unknown>, value: unknown, path: string): string[] {
  const violations: string[] = []
  const type = schema.type
  if (type === 'object' || schema.properties || schema.required) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      violations.push(`${path} must be an object`)
      return violations
    }
    const record = value as Record<string, unknown>
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
    const required = Array.isArray(schema.required) ? schema.required as string[] : []
    for (const key of required) {
      if (!(key in record)) violations.push(`${path} must have required property '${key}'`)
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in properties)) {
          violations.push(`"${path}.${key}" is not a declared property (additionalProperties: false)`)
        }
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (key in record) violations.push(...validateAgainstSchema(child, record[key], `${path}.${key}`))
    }
    return violations
  }
  if (type === 'array' && !Array.isArray(value)) violations.push(`${path} must be an array`)
  if (type === 'string' && typeof value !== 'string') violations.push(`${path} must be a string`)
  if (type === 'boolean' && typeof value !== 'boolean') violations.push(`${path} must be a boolean`)
  if (type === 'number' && typeof value !== 'number') violations.push(`${path} must be a number`)
  return violations
}

/**
 * Local stand-in for published `defineTool` + `ToolRuntime` dispatch.
 * `createSuccessResult` snapshots the body return, validates `output.schema`,
 * then calls `output.render`. An MCP `{ content, isError }` envelope fails
 * a closed object schema the same way the host throws ToolOutputError.
 */
function createRegistry() {
  const tools = new Map<string, RoutineToolDefinition>()
  return {
    register(definition: unknown) {
      const tool = officialRegister(definition as RoutineToolDefinition)
      tools.set(tool.name, tool)
      return () => { tools.delete(tool.name) }
    },
    async execute(input: { name: string; arguments?: Record<string, unknown> }) {
      const tool = tools.get(input.name)
      if (!tool) throw new Error(`unknown tool "${input.name}"`)
      const returned = await tool.execute(input.arguments ?? {}, {
        name: input.name,
        arguments: input.arguments ?? {},
        signal: new AbortController().signal,
      })
      const detached = snapshotToolValue(tool.name, returned)
      const violations = validateAgainstSchema(tool.output.schema as Record<string, unknown>, detached, 'value')
      if (violations.length > 0) throw new ToolOutputError(tool.name, violations)
      const content = tool.output.render(input.arguments ?? {}, detached)
      return { value: detached, content, isError: false }
    },
  }
}

async function runtimeAt(now = Date.parse('2026-01-01T00:00:00Z')): Promise<RoutineRuntime> {
  const store = new RoutineStore(filePersist(join(mkdtempSync(join(tmpdir(), 'lumine-routines-')), 'routines.json')))
  await store.load()
  return new RoutineRuntime(store, {}, () => now)
}

describe('defineTool + official register contract', () => {
  it('rejects a definition that omits output.{ schema, render }', () => {
    expect(() => officialRegister({
      name: 'routine_list',
      description: 'broken',
      execute: async () => ({ routines: [] }),
    } as never)).toThrow(/must declare output \{ schema, render/)
  })

  it('defineTool + registry dispatch of routine_list / routine_create returns JSON, not an MCP envelope', async () => {
    const runtime = await runtimeAt()
    const registry = createRegistry()

    for (const tool of createRoutineToolDefinitions(runtime)) {
      expect(() => registry.register(tool)).not.toThrow()
    }

    const listed = await registry.execute({ name: 'routine_list', arguments: {} })
    expect(listed.value).toEqual({ routines: [] })
    expect(listed.value).not.toHaveProperty('content')
    expect(listed.value).not.toHaveProperty('isError')
    expect(listed.content[0]?.type).toBe('text')

    const created = await registry.execute({
      name: 'routine_create',
      arguments: {
        title: 'morning',
        promptTemplate: 'Review the inbox',
        rule: { kind: 'manual' },
      },
    })
    expect(created.value).toMatchObject({
      enabled: false,
      saved_paused: true,
      operator_must_enable: true,
      routine: { title: 'morning', enabled: false },
    })
    expect(created.value).not.toHaveProperty('content')
    expect(created.value).not.toHaveProperty('isError')
    expect((created.value as { routine: { promptTemplate: string } }).routine.promptTemplate).toBe('Review the inbox')
    expect('nextRunAt' in (created.value as { routine: object }).routine).toBe(false)
  })

  it('createSuccessResult rejects own enumerable undefined the way the host does', () => {
    expect(snapshotJsonValue({ nextRunAt: undefined })).toBeUndefined()
    expect(snapshotJsonValue({ routines: [{ nextRunAt: undefined }] })).toBeUndefined()
    expect(snapshotJsonValue({ routines: [] })).toEqual({ routines: [] })
  })

  it('paused routine_create (manual/interval/once) then routine_list survive createSuccessResult', async () => {
    const runtime = await runtimeAt()
    const registry = createRegistry()
    for (const tool of createRoutineToolDefinitions(runtime)) registry.register(tool)

    const clocks = [
      { kind: 'manual' as const },
      { kind: 'interval' as const, seconds: 60 },
      { kind: 'once' as const, at: Date.parse('2026-02-01T12:00:00Z') },
    ]
    for (const [index, rule] of clocks.entries()) {
      const created = await registry.execute({
        name: 'routine_create',
        arguments: {
          title: `paused-${rule.kind}`,
          promptTemplate: `ping ${index}`,
          rule,
        },
      })
      const routine = (created.value as { routine: Record<string, unknown>; enabled: boolean }).routine
      expect(created.value).toMatchObject({
        enabled: false,
        saved_paused: true,
        operator_must_enable: true,
      })
      expect(routine.enabled).toBe(false)
      expect('nextRunAt' in routine).toBe(false)
      expect(snapshotJsonValue(created.value)).toEqual(created.value)
    }

    const listed = await registry.execute({ name: 'routine_list', arguments: {} })
    const routines = (listed.value as { routines: Array<Record<string, unknown>> }).routines
    expect(routines).toHaveLength(3)
    for (const routine of routines) {
      expect(routine.enabled).toBe(false)
      expect('nextRunAt' in routine).toBe(false)
    }
    expect(snapshotJsonValue(listed.value)).toEqual(listed.value)
  })

  it('createSuccessResult would ToolOutputError an MCP envelope against the list schema', async () => {
    const envelopeTool = defineRoutineTool({
      name: 'routine_list',
      description: 'wrong execute return',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { routines: { type: 'array', required: true } },
        },
      },
      execute: async () => ({ content: [{ type: 'text', text: '[]' }], isError: false }),
    })
    const registry = createRegistry()
    registry.register(envelopeTool)
    await expect(registry.execute({ name: 'routine_list' })).rejects.toMatchObject({
      name: 'ToolOutputError',
    })
  })

  it('contains a register throw so the caller is not a constructor failure', async () => {
    const runtime = await runtimeAt()
    const warnings: string[] = []
    const names = registerRoutineTools({
      logger: { warn: (...args: unknown[]) => { warnings.push(String(args[0])) } },
      tools: {
        register() {
          throw new TypeError('tool "routine_list" must declare output { schema, render, presentationMeta? }')
        },
      },
    }, runtime)
    expect(names).toEqual([])
    expect(warnings.some(line => line.includes('routine_list'))).toBe(true)
  })
})
