import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { TokenSaverLevel } from '../store.ts'
import css from './Dial.module.css'

export interface TokenSaverRpc {
  call(route: string, endpoint: string, payload: { args: Record<string, unknown> }, signal?: AbortSignal): Promise<unknown>
}

const LEVELS = [
  { value: 'off', label: 'Off', shortLabel: 'O' },
  { value: 'light', label: 'Light', shortLabel: 'L' },
  { value: 'balanced', label: 'Balanced', shortLabel: 'B' },
  { value: 'aggressive', label: 'Aggressive', shortLabel: 'A' },
] as const satisfies readonly { value: TokenSaverLevel; label: string; shortLabel: string }[]

function unwrap(result: unknown): unknown {
  if (result !== null && typeof result === 'object' && 'ok' in result) {
    const envelope = result as { ok: boolean; value?: unknown }
    if (!envelope.ok) throw new Error('token saver rpc failed')
    return envelope.value
  }
  return result
}

function levelFrom(value: unknown): TokenSaverLevel {
  return LEVELS.some(option => option.value === value) ? value as TokenSaverLevel : 'light'
}

export interface DialProps {
  rpc?: TokenSaverRpc
}

export function Dial(props: DialProps): ReactNode {
  const [level, setLevel] = useState<TokenSaverLevel>('light')
  const generation = useRef(0)

  useEffect(() => {
    if (!props.rpc) return
    const gen = generation.current
    let active = true
    void props.rpc.call('/api', 'tokenSaver/get', { args: {} }).then(result => {
      if (!active || gen !== generation.current) return
      const value = unwrap(result)
      const state = value !== null && typeof value === 'object' ? value as { level?: unknown } : {}
      setLevel(levelFrom(state.level))
    }).catch(() => {})
    return () => { active = false }
  }, [props.rpc])

  const choose = (next: TokenSaverLevel): void => {
    const gen = ++generation.current
    const previous = level
    setLevel(next)
    if (!props.rpc) return
    void props.rpc.call('/api', 'tokenSaver/set', { args: { level: next } }).then(result => {
      if (gen !== generation.current) return
      unwrap(result)
    }).catch(() => {
      if (gen !== generation.current) return
      setLevel(previous)
    })
  }

  return (
    <div className={css.dial} role="group" aria-label="Token Saver">
      {LEVELS.map(option => (
        <button
          key={option.value}
          type="button"
          className={css.option}
          aria-label={option.label}
          aria-pressed={option.value === level}
          onClick={() => { choose(option.value) }}
        >
          {option.shortLabel}
        </button>
      ))}
    </div>
  )
}
