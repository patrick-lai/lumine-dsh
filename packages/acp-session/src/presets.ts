import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const USER_PRESET_DIR = '.agent-presets'

export const PRESET_IDS = ['claude-code', 'codex', 'cursor', 'grok-build'] as const

export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DSH_HOME?.trim()
  if (fromEnv) {
    if (fromEnv === '~') return homedir()
    if (fromEnv.startsWith('~/') || fromEnv.startsWith('~\\')) return join(homedir(), fromEnv.slice(2))
    return fromEnv
  }
  return join(homedir(), '.dsh')
}

export function shippedPresetRoot(): string {
  return fileURLToPath(new URL('../presets/', import.meta.url))
}

/**
 * Copy the four product presets into `$DSH_HOME/.agent-presets` so the Web
 * picker lists them. Existing files are overwritten so an upgrade refreshes
 * display metadata; user copies with other ids are left alone.
 */
export function installPickerPresets(env: NodeJS.ProcessEnv = process.env): string {
  const destRoot = join(resolveDshHome(env), USER_PRESET_DIR)
  const sourceRoot = shippedPresetRoot()
  mkdirSync(destRoot, { recursive: true })
  for (const id of PRESET_IDS) {
    const from = join(sourceRoot, id)
    const to = join(destRoot, id)
    mkdirSync(to, { recursive: true })
    for (const name of readdirSync(from)) {
      writeFileSync(join(to, name), readFileSync(join(from, name)))
    }
  }
  return destRoot
}

export function presetInstallPath(env?: NodeJS.ProcessEnv): string {
  return dirname(join(resolveDshHome(env), USER_PRESET_DIR, 'claude-code', 'preset.yml'))
}
