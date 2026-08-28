/**
 * Host-side secret scrub. The daemon scrubs again; defense on both ends.
 * False positives only cost a little context.
 */

interface ScrubRule {
  pattern: RegExp
  replace: string
}

const RULES: readonly ScrubRule[] = [
  { pattern: /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}/g, replace: '[redacted-jwt]' },
  { pattern: /xox[baprs]-[A-Za-z0-9-]{8,}/g, replace: '[redacted-token]' },
  { pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g, replace: '[redacted-token]' },
  { pattern: /github_pat_[A-Za-z0-9_]{20,}/g, replace: '[redacted-token]' },
  { pattern: /AKIA[0-9A-Z]{16}/g, replace: '[redacted-key]' },
  { pattern: /authorization:\s*\S+/gi, replace: 'authorization: [redacted]' },
  { pattern: /bearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, replace: 'bearer [redacted]' },
  {
    pattern: /(api[_-]?key|secret|token|password|passwd|pwd|_?authtoken|access[_-]?key)(\s*[=:]\s*)\S+/gi,
    replace: '$1$2[redacted]',
  },
  { pattern: /\b[0-9a-fA-F]{32,}\b/g, replace: '[redacted-hex]' },
  { pattern: /\b[A-Za-z0-9+/]{40,}={0,2}\b/g, replace: '[redacted-b64]' },
]

export function scrubSecrets(text: string): string {
  let out = text
  for (const rule of RULES) {
    out = out.replace(rule.pattern, rule.replace)
  }
  return out
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function nonEmpty(text: string | undefined | null): string | undefined {
  if (typeof text !== 'string') return undefined
  const trimmed = text.trim()
  return trimmed ? trimmed : undefined
}

export function suffix(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(-maxChars)
}

export function prefix(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars)
}
