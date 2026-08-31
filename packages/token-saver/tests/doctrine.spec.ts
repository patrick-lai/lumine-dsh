import { describe, expect, it } from 'vitest'
import { doctrineFor, tokenOffloadSection } from '../src/doctrine.ts'

describe('token saver doctrine', () => {
  it('is empty when off', () => expect(tokenOffloadSection('off')).toBe(''))
  it('includes graph-first doctrine at balanced', () => expect(doctrineFor('balanced')).toMatch(/GRAPH FIRST/))
  it('adds sub-break doctrine at aggressive', () => expect(doctrineFor('aggressive')).toMatch(/SUB-BREAK/))
})
