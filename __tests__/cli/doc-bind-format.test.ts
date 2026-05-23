import { formatBindOutput } from '@/cli/src/commands/doc-bind'

describe('formatBindOutput', () => {
  it('renders a fresh bind line', () => {
    expect(
      formatBindOutput({
        docId: 'c1',
        identifier: 'LUM-42',
        alreadyBound: false,
        upgradedFromContent: false,
      })
    ).toBe('Bound c1 ↔ LUM-42')
  })
  it('renders idempotent already-bound line', () => {
    expect(
      formatBindOutput({
        docId: 'c1',
        identifier: 'LUM-42',
        alreadyBound: true,
        upgradedFromContent: false,
      })
    ).toBe('Already bound c1 ↔ LUM-42')
  })
  it('renders upgrade annotation', () => {
    expect(
      formatBindOutput({
        docId: 'c1',
        identifier: 'LUM-42',
        alreadyBound: false,
        upgradedFromContent: true,
      })
    ).toBe('Bound c1 ↔ LUM-42 (upgraded from content)')
  })
})
