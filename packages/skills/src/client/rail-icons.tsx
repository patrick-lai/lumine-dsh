import type { ReactNode } from 'react'

/** 16px currentColor glyphs so collapsed rail actions are visually distinct. */
export function WorktreesIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M7 2.5a1.5 1.5 0 1 1-1 2.83V8h3.5A2.5 2.5 0 0 1 12 5.5h.5a1.5 1.5 0 1 1 0 1H12A1.5 1.5 0 0 0 10.5 8H12a1.5 1.5 0 1 1 0 1H10.5A1.5 1.5 0 0 0 12 10.5h.5a1.5 1.5 0 1 1 0 1H12A2.5 2.5 0 0 1 9.5 9H6v1.67a1.5 1.5 0 1 1-1 0V5.33A1.5 1.5 0 0 1 7 2.5Z"
      />
    </svg>
  )
}

export function MemoryIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M4.5 2A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14H12a1 1 0 0 0 1-1V3.5A1.5 1.5 0 0 0 11.5 2h-7Zm0 1h7a.5.5 0 0 1 .5.5V12H4.5a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5ZM6 5h5v1H6V5Zm0 2.5h5v1H6v-1ZM6 10h3v1H6v-1Z"
      />
    </svg>
  )
}
