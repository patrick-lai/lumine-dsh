/** Ambient browser types supplied by DSH at runtime. */

declare module 'react' {
  export type ReactNode = unknown
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useState<T>(init: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void]
}

declare module 'react/jsx-runtime' {
  export function jsx(type: unknown, props: unknown, key?: unknown): unknown
  export function jsxs(type: unknown, props: unknown, key?: unknown): unknown
  export const Fragment: unique symbol
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {}
declare module '@deepseek-ai/dsh-client-ui-sidebar/client' {}
declare module '@deepseek-ai/dsh-client-locale/client' {}
declare module '@deepseek-ai/dsh-client-connection/client' {}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  export type InjectFace<T> = T
  export type PropsLocale<_NS extends string> = { t: (key: string) => string }
  export type PropsRuntime<_N extends string> = { close?: () => void; wide?: boolean }
}

declare const document: {
  addEventListener(type: string, listener: (event: { key: string }) => void): void
  removeEventListener(type: string, listener: (event: { key: string }) => void): void
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
  export function IconDataOutline16(props?: { className?: string }): ReactNode
  export function IconCloseOutline16(props?: { className?: string }): ReactNode
}

declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}
