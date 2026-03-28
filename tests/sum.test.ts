import { sum } from '@/utils/sum'

describe('sum', () => {
  it('returns 3 when adding 1 and 2', () => {
    expect(sum(1, 2)).toBe(3)
  })

  it('returns 0 when adding -1 and 1', () => {
    expect(sum(-1, 1)).toBe(0)
  })

  it('returns 0 when adding 0 and 0', () => {
    expect(sum(0, 0)).toBe(0)
  })
})
