import { describe, expect, it } from 'vitest'

import { inject, name } from '../src/plugin.ts'

describe('skills plugin contract', () => {
  it('requires only the command registry', () => {
    expect(name).toBe('lumine-skills')
    expect(inject).toEqual(['commands'])
  })
})
