import { parseInstallationIds } from '@/lib/validation/github-installation-ids'

describe('LUM-927 parseInstallationIds', () => {
  it('reads a comma list of installation ids', () => {
    expect(parseInstallationIds('12, 34,56')).toEqual([12, 34, 56])
  })

  it('drops anything that is not a positive integer', () => {
    expect(parseInstallationIds('12,abc,-3,0,1.5,,9007199254740993')).toEqual([
      12,
    ])
  })

  it('confirms nothing without the parameter', () => {
    expect(parseInstallationIds(null)).toEqual([])
    expect(parseInstallationIds('')).toEqual([])
  })
})
