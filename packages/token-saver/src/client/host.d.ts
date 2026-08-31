declare module 'react' {
  export type ReactNode = unknown
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useState<T>(init: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void]
  export function useRef<T>(init: T): { current: T }
}

declare module '@deepseek-ai/dsh-client-ui-settings/client' {}
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {}
declare module '@deepseek-ai/dsh-client-locale/client' {}
declare module '@deepseek-ai/dsh-client-connection/client' {}

declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}
