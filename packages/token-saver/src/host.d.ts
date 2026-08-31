declare module '@deepseek-ai/cordis' {
  export class Context {
    systemPrompt: { section(options: { name: string; order: number; text: string }): (() => void) | unknown }
    commands: {
      register(definition: {
        name: string
        description: string
        input?: { hint?: string; images?: boolean }
        handler: (invocation: { rawInput?: string }) => unknown
      }): unknown
    }
    logger: { warn(...args: unknown[]): void; info(...args: unknown[]): void; error(...args: unknown[]): void }
    get<T = unknown>(name: string): T | undefined
    plugin(plugin: unknown, config?: unknown): { ctx: Context; dispose: () => Promise<void> | void }
  }

  export class Service {
    ctx: Context
    constructor(ctx: Context, name: string)
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  import type { Context, Service } from '@deepseek-ai/cordis'
  export abstract class TypertRemoteService extends Service {
    constructor(ctx: Context, serviceKey: string, options?: { namespace?: string })
  }
  export function Remote(method: string): MethodDecorator
}
