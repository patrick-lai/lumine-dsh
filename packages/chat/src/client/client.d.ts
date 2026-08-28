/** Public types for `@lumine/dsh-chat/client`. Emitted to `lib/client.d.ts` on build. */

export const inject: string[]
export function apply(ctx: unknown): void
export const MINIMUM_GROUP_SIZE: number
export function ToolGroupNode(props: unknown): unknown
export function collectRun(
  order: readonly string[],
  nodes: { get(key: string): unknown },
  nodeKey: string,
  minimum?: number,
): { role: 'solo' | 'leader' | 'follower'; members: readonly unknown[] }
export function roleInRun(
  kinds: readonly (string | undefined)[],
  index: number,
  minimum?: number,
): 'solo' | 'leader' | 'follower'
export function tallyRoles(
  kinds: readonly (string | undefined)[],
  minimum?: number,
): { solo: number; leader: number; follower: number }
export function walkToolTree(block: unknown): unknown[]
export function resultText(block: unknown): string
export function toolViewOwner(block: unknown, options: unknown): Record<string, unknown>
export function subCallsOf(block: unknown): readonly unknown[]
export function faceSnapshot(members: readonly unknown[]): unknown
export function verbFor(name: string): string
export function toolKind(name: string): string
export function targetFor(block: unknown): string
export function runOutcome(members: readonly unknown[]): string
