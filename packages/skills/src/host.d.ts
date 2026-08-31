declare module '@deepseek-ai/cordis' {
  export class Context {
    commands: {
      register(definition: {
        name: string
        description: string
        input?: { hint?: string; images?: boolean }
        handler: (invocation: unknown) => unknown
      }): unknown
    }
  }
}
