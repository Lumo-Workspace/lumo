import {
  severityFor,
  isReversible,
} from '@/lib/services/boundary-detector.service'

describe('SESSION_BINDING_MISSING taxonomy', () => {
  it('is MEDIUM severity', () => {
    expect(severityFor('SESSION_BINDING_MISSING')).toBe('MEDIUM')
  })
  it('is not reversible', () => {
    expect(isReversible('SESSION_BINDING_MISSING')).toBe(false)
  })
})
