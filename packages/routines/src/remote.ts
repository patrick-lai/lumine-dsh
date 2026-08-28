import { createRequire } from 'node:module'
import { ROUTINE_RPC_METHODS, ROUTINE_RPC_NAMESPACE, routineRpcHandlers, type RoutineHost } from './rpc-payload.ts'

type RpcRegister = (name: string, handler: (...args: unknown[]) => unknown) => void

interface TypertRemoteBinding {
  readonly service: object
  readonly serviceKey: string
  readonly namespace: string
}

interface InvocationDescriptor {
  readonly id: string
  readonly service: string
  readonly namespace: string
  readonly method: string
  readonly implementation?: string
  readonly invocation: { readonly kind: 'direct' }
  readonly parameters: ReadonlyArray<{
    readonly name: string
    readonly wire: string
    readonly source: 'json'
    readonly codec: { readonly mode: 'src-json' }
  }>
  readonly result: { readonly mode: 'src-json' }
}

const EXPORT_NAMES: Record<string, string> = {
  list: 'remoteExportList',
  create: 'remoteExportCreate',
  update: 'remoteExportUpdate',
  delete: 'remoteExportDelete',
  enable: 'remoteExportEnable',
  runNow: 'remoteExportRunNow',
}

function jsonParam(name: string): InvocationDescriptor['parameters'][number] {
  return { name, wire: name, source: 'json', codec: { mode: 'src-json' } }
}

function descriptorsFor(serviceKey: string): InvocationDescriptor[] {
  const params: Record<string, Array<{ name: string }>> = {
    list: [],
    create: [{ name: 'input' }],
    update: [{ name: 'id' }, { name: 'input' }],
    delete: [{ name: 'id' }],
    enable: [{ name: 'id' }, { name: 'enabled' }],
    runNow: [{ name: 'id' }],
  }
  return ROUTINE_RPC_METHODS.map(method => ({
    id: `@lumine/dsh-routines#${ROUTINE_RPC_NAMESPACE}/${method}`,
    service: serviceKey,
    namespace: ROUTINE_RPC_NAMESPACE,
    method,
    implementation: EXPORT_NAMES[method],
    invocation: { kind: 'direct' as const },
    parameters: (params[method] ?? []).map(item => jsonParam(item.name)),
    result: { mode: 'src-json' as const },
  }))
}

function loadProtocol(): {
  bindTypertRemote?: (service: object, serviceKey: string, options?: { namespace?: string }) => TypertRemoteBinding
  Remote?: (exportName?: string) => (target: object, key: string, descriptor?: PropertyDescriptor) => unknown
} | undefined {
  try {
    const require = createRequire(import.meta.url)
    return require('@deepseek-ai/dsh-typert-protocol') as {
      bindTypertRemote?: (service: object, serviceKey: string, options?: { namespace?: string }) => TypertRemoteBinding
      Remote?: (exportName?: string) => (target: object, key: string, descriptor?: PropertyDescriptor) => unknown
    }
  } catch {
    return undefined
  }
}

function markRemoteExports(ctor: { prototype: object }): void {
  const protocol = loadProtocol()
  const Remote = protocol?.Remote
  if (typeof Remote !== 'function') return
  for (const [exportName, implementation] of Object.entries(EXPORT_NAMES)) {
    const descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, implementation)
    if (descriptor === undefined) continue
    try {
      Remote(exportName)(ctor.prototype, implementation, descriptor)
    } catch {
      // Marker is best-effort. Handmade descriptors still register below.
    }
  }
}

function bindRemote(service: object, serviceKey: string): TypertRemoteBinding {
  const protocol = loadProtocol()
  if (typeof protocol?.bindTypertRemote === 'function') {
    return protocol.bindTypertRemote(service, serviceKey, { namespace: ROUTINE_RPC_NAMESPACE })
  }
  return Object.freeze({ service, serviceKey, namespace: ROUTINE_RPC_NAMESPACE })
}

/**
 * Duck-typed `rpc.register('routine.list')` plus Typert `routine/list`
 * so the Settings pane can call `connection.rpc.call('/api', 'routine/list', { args })`.
 */
export function exportRoutineRemote(
  ctx: {
    get<T = unknown>(name: string): T | undefined
    logger?: { warn(...args: unknown[]): void }
  },
  service: RoutineHost & { typertRemote?: TypertRemoteBinding },
  ctor: { prototype: object },
  serviceKey = 'routines',
): string[] {
  const handlers = routineRpcHandlers(service)
  const exported: string[] = []

  service.typertRemote = bindRemote(service, serviceKey)
  markRemoteExports(ctor)

  const rpc = ctx.get<{ register?: RpcRegister }>('rpc')
  if (rpc && typeof rpc.register === 'function') {
    for (const name of ROUTINE_RPC_METHODS) {
      const handler = handlers[name] as (...args: unknown[]) => unknown
      rpc.register(`${ROUTINE_RPC_NAMESPACE}.${name}`, handler)
      exported.push(`${ROUTINE_RPC_NAMESPACE}.${name}`)
    }
  }

  const typert = ctx.get<{
    remotes?: { register?: (contribution: { package: string; descriptors: InvocationDescriptor[] }) => unknown }
  }>('typert')
  try {
    typert?.remotes?.register?.({
      package: '@lumine/dsh-routines',
      descriptors: descriptorsFor(serviceKey),
    })
    exported.push(`${ROUTINE_RPC_NAMESPACE}/*`)
  } catch (error) {
    ctx.logger?.warn(
      `lumine-routines: typert remotes.register failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  return exported
}
