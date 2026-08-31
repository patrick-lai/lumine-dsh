import { cpSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUNDLED_SKILLS = [
  'review',
  'wayfinder',
  'pr-warden',
  'second-opinion',
  'leyline-memory',
] as const

export type BundledSkillName = typeof BUNDLED_SKILLS[number]

export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DSH_HOME?.trim()
  if (fromEnv) {
    if (fromEnv === '~') return homedir()
    if (fromEnv.startsWith('~/') || fromEnv.startsWith('~\\')) {
      return join(homedir(), fromEnv.slice(2))
    }
    return fromEnv
  }
  return join(homedir(), '.dsh')
}

export function shippedSkillsRoot(): string {
  return fileURLToPath(new URL('../skills/', import.meta.url))
}

/** Refresh the package-owned skills while leaving unrelated user skills alone. */
export function installSkills(
  env: NodeJS.ProcessEnv = process.env,
  sourceRoot = shippedSkillsRoot(),
): string {
  const destinationRoot = join(resolveDshHome(env), 'skills')
  mkdirSync(destinationRoot, { recursive: true })
  for (const name of BUNDLED_SKILLS) {
    cpSync(join(sourceRoot, name), join(destinationRoot, name), {
      recursive: true,
      force: true,
    })
  }
  return destinationRoot
}
