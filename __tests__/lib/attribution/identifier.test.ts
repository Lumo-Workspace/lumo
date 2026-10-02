import {
  canonicalTaskIdentifier,
  parseTaskIdentifier,
} from '@/lib/attribution/identifier'

describe('task identifier helpers', () => {
  it('parses and uppercases the team, numeric number', () => {
    expect(parseTaskIdentifier('lum-012')).toEqual({ team: 'LUM', number: 12 })
    expect(parseTaskIdentifier('nope')).toBeNull()
  })

  it('canonicalises LUM-012 to LUM-12', () => {
    expect(canonicalTaskIdentifier('LUM-012')).toBe('LUM-12')
    expect(canonicalTaskIdentifier('x')).toBeNull()
  })
})
