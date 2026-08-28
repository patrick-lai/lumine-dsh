import { Remote } from '@deepseek-ai/dsh-typert-protocol'

export const ROUTINE_REMOTE_METHODS = ['list', 'create', 'update', 'delete', 'enable', 'runNow'] as const

interface RemoteInitializerContext {
  readonly kind?: string
  readonly private: boolean
  readonly static: boolean
  readonly name: string | symbol
  addInitializer(initializer: (this: object) => void): void
}

type RemoteDecorator = {
  (method: (...args: never[]) => unknown, context: RemoteInitializerContext): void
}

/**
 * Published `Remote()` is TC39 (`context.addInitializer`). Node 22 cannot
 * parse leftover `@Remote()` in the emitted JS, so we invoke the initializer
 * `Remote` actually installs. After this, `remoteMethods()` is non-empty.
 */
export function installRoutineRemoteMarkers(ctor: { prototype: object }): void {
  const decorate = Remote as unknown as RemoteDecorator
  for (const name of ROUTINE_REMOTE_METHODS) {
    const method = (ctor.prototype as Record<string, unknown>)[name]
    if (typeof method !== 'function') continue
    decorate(method as (...args: never[]) => unknown, {
      kind: 'method',
      name,
      private: false,
      static: false,
      addInitializer(initializer) {
        initializer.call(Object.create(ctor.prototype))
      },
    })
  }
}
