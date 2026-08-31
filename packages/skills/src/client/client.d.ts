/** Public types for `@lumine/dsh-skills/client`. Emitted to `lib/client.d.ts` on build. */

export const inject: string[]
export function apply(ctx: unknown): void
export const SKILL_ACTIONS: readonly {
  readonly line: 'review' | 'wayfinder' | 'pr-warden' | 'second-opinion'
  readonly label: string
}[]
export function executeSkillAction(rpc: unknown, sessionId: string, line: string): Promise<unknown>
export function commandExecuteLine(line: string): string
export function SkillActions(props: unknown): unknown
export function pathFromBound(result: unknown): string
export function WorktreeChip(props: unknown): unknown
