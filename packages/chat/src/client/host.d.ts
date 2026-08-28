/**
 * Ambient client types. Official DSH packages provide these at runtime.
 * Declared here so the client half builds without a sibling DSH checkout.
 */

declare module 'react' {
  export type ReactNode = unknown
  export type Key = string | number
  export interface CSSProperties {
    [key: string]: string | number | undefined
  }
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useState<T>(init: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void]
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T
  export function useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]): T
  export function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
}

declare module 'react/jsx-runtime' {
  export function jsx(type: unknown, props: unknown, key?: unknown): unknown
  export function jsxs(type: unknown, props: unknown, key?: unknown): unknown
  export function jsxDEV(type: unknown, props: unknown, key?: unknown): unknown
  export const Fragment: unique symbol
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {}
declare module '@deepseek-ai/dsh-client-ui-tool/client' {}
declare module '@deepseek-ai/dsh-client-locale/client' {}
declare module '@deepseek-ai/dsh-client-runtime/client' {}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  export type InjectFace<T> = T
  export type PropsLocale<_NS extends string> = { t: (key: string) => string }
  export type PropsRuntime<_N extends string> = { close?: () => void; wide?: boolean }
}

declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}
