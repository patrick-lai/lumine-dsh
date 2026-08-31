import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUNDLED_SKILLS, installSkills, resolveDshHome } from '../src/install-skills.ts'

function fakeBundle(): string {
  const root = mkdtempSync(join(tmpdir(), 'lumine-skills-bundle-'))
  for (const name of BUNDLED_SKILLS) {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), `# ${name}\n`)
  }
  return root
}

describe('bundled skill installation', () => {
  it('copies all five skills into DSH_HOME and preserves unrelated skills', () => {
    const dshHome = mkdtempSync(join(tmpdir(), 'lumine-dsh-home-'))
    const unrelated = join(dshHome, 'skills', 'operator-owned', 'SKILL.md')
    mkdirSync(join(dshHome, 'skills', 'operator-owned'), { recursive: true })
    writeFileSync(unrelated, '# operator owned\n')

    const destination = installSkills({ DSH_HOME: dshHome }, fakeBundle())

    expect(destination).toBe(join(dshHome, 'skills'))
    expect(BUNDLED_SKILLS).toEqual([
      'review',
      'wayfinder',
      'pr-warden',
      'second-opinion',
      'leyline-memory',
    ])
    for (const name of BUNDLED_SKILLS) {
      expect(readFileSync(join(destination, name, 'SKILL.md'), 'utf8')).toBe(`# ${name}\n`)
    }
    expect(existsSync(unrelated)).toBe(true)
  })

  it('uses a literal DSH_HOME path without requiring a live Harness', () => {
    expect(resolveDshHome({ DSH_HOME: '/tmp/example-dsh-home' })).toBe('/tmp/example-dsh-home')
  })
})
