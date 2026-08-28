/**
 * Own enumerable `undefined` is not lossless JSON.
 * Published `@deepseek-ai/dsh-session` `snapshotJsonValue` returns `undefined`
 * for that case, and `createSuccessResult` then throws
 * `ToolOutputError: value is not lossless JSON`.
 */
export function omitUndefined<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => omitUndefined(item)) as T
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as object)) {
    const item = (value as Record<string, unknown>)[key]
    if (item === undefined) continue
    out[key] = omitUndefined(item)
  }
  return out as T
}
