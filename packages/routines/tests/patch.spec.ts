import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function patch(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

const root = patch('../../../cordis.patch.yml')
const pkg = patch('../cordis.patch.yml')
const readme = patch('../../../README.md')
const service = patch('../src/service.ts')
const tools = patch('../src/tools.ts')

describe('routines bundle cordis overlay', () => {
  it('inserts lumine-routines on the root bundle without disabling agent-loop itself', () => {
    expect(root).toMatch(/id:\s*lumine-routines/)
    expect(root).toMatch(/name:\s*'@lumine\/dsh-routines'/)
    expect(root).toMatch(/id:\s*lumine-acp-session/)
    expect(root).toMatch(/id:\s*agent-loop[\s\S]*disabled:\s*true/)
    expect(root).not.toMatch(/id:\s*llm-deepseek[\s\S]*disabled:\s*true/)
    expect(root).not.toMatch(/apiKeyEnv:\s*DEEPSEEK_API_KEY/)
  })

  it('package-only overlay inserts this plugin only', () => {
    expect(pkg).toMatch(/id:\s*lumine-routines/)
    expect(pkg).toMatch(/name:\s*'@lumine\/dsh-routines'/)
    expect(pkg).toMatch(/tickMs:\s*30000/)
    expect(pkg).not.toMatch(/grindMaxTurns/)
    expect(pkg).not.toMatch(/id:\s*agent-loop/)
    expect(pkg).not.toMatch(/id:\s*lumine-acp-session/)
    expect(pkg).not.toMatch(/id:\s*directory-picker-browse/)
    expect(pkg).not.toMatch(/id:\s*ui-directory-picker-browse/)
    expect(pkg).not.toMatch(/id:\s*llm-deepseek[\s\S]*disabled:\s*true/)
    expect(pkg).toMatch(/Do not disable agent-loop/)
  })

  it('does not add a /routine slash or a second timer service', () => {
    expect(readme).not.toMatch(/\/routine /)
    expect(pkg).not.toMatch(/setInterval/)
    expect(root).toMatch(/tickMs:\s*30000/)
    expect(root).not.toMatch(/grindMaxTurns/)
    expect(service).not.toMatch(/\bsetInterval\s*\(/)
    expect(service).not.toMatch(/['"]schedule\/change['"]/)
    expect(service).toMatch(/installTimer/)
    expect(service).toMatch(/static inject = \['agents', 'timer', 'sessions'\]/)
    expect(service).not.toMatch(/typeof this\.ctx\.interval/)
    expect(service).not.toMatch(/static inject = \[[^\]]*storageDomain/)
    expect(patch('../src/plugin.ts')).toMatch(/export const inject = \['agents', 'timer', 'sessions'\]/)
    expect(tools).toMatch(/'routine_list'/)
    expect(tools).toMatch(/'routine_run_now'/)
    expect(tools).not.toMatch(/name:\s*'schedule_/)
    expect(tools).not.toMatch(/name:\s*'routine_enable'/)
    expect(tools).toMatch(/output:\s*\{[\s\S]*schema/)
    expect(tools).toMatch(/saved_paused/)
    expect(tools).toMatch(/operator_must_enable/)
    expect(service).toMatch(/TypertRemoteService/)
    expect(service).toMatch(/super\(ctx, 'routine'\)/)
    expect(service).toMatch(/installRoutineRemoteMarkers/)
    expect(service).not.toMatch(/rpc\.register/)
    expect(service).not.toMatch(/remotes\.register/)
  })

  it('loads the Routines tab from the same package client half, not a profile overlay', () => {
    const manifest = JSON.parse(patch('../package.json')) as {
      dsh?: { client?: { platform?: string } }
    }
    expect(manifest.dsh?.client?.platform).toBe('web')
    expect(pkg).not.toMatch(/id:\s*ui-lumine-routines/)
    expect(pkg).not.toMatch(/dsh-client-ui-routines/)
    expect(root).not.toMatch(/id:\s*ui-lumine-routines/)
    expect(root).not.toMatch(/dsh-client-ui-routines/)
  })

  it('does not tell people to re-insert directory-picker-browse in a profile overlay', () => {
    expect(readme).toMatch(/Do not copy those browse rows into the profile `cordis\.patch\.yml`/)
    expect(readme).not.toMatch(/profile `cordis\.patch\.yml`[\s\S]{0,200}directory-picker-browse/)
  })
})
