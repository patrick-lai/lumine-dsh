/**
 * Ambient client types. Official DSH packages provide these at runtime.
 * Declared here so the Settings half builds without a sibling DSH checkout.
 * Do not redeclare `@deepseek-ai/cordis` here: the host face already owns it.
 */

declare module 'react' {
  export type ReactNode = unknown
  export type Key = string | number
  export interface ChangeEvent<T = Element> {
    readonly currentTarget: T
    readonly target: T
  }
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useState<T>(init: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void]
  export function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
}

declare module 'react/jsx-runtime' {
  export function jsx(type: unknown, props: unknown, key?: unknown): unknown
  export function jsxs(type: unknown, props: unknown, key?: unknown): unknown
  export function jsxDEV(type: unknown, props: unknown, key?: unknown): unknown
  export const Fragment: unique symbol
}

declare module '@deepseek-ai/dsh-client-ui-settings/client' {}
declare module '@deepseek-ai/dsh-client-locale/client' {}
declare module '@deepseek-ai/dsh-client-ui-renderer/client' {}
declare module '@deepseek-ai/dsh-api-remotes/client' {}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  export type InjectFace<T> = T
  export type PropsLocale<_NS extends string> = { t: (key: string) => string }
  export type PropsRuntime<_N extends string> = { close?: () => void }
}

declare module '@deepseek-ai/dsh-client-store' {
  export interface SnapshotStore<T> {
    getSnapshot(): T
    subscribe(listener: () => void): () => void
  }
}

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactNode } from 'react'
  export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'toolbar'
  export function Button(props: {
    variant?: ButtonVariant
    size?: 'md' | 'sm'
    icon?: ReactNode
    className?: string
    disabled?: boolean
    type?: 'button' | 'submit' | 'reset'
    onClick?: () => void
    children?: ReactNode
  }): ReactNode
}

declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}
