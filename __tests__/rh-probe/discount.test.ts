import { discountedPrice } from '../../scripts/rh-probe/discount'

describe('discountedPrice', () => {
  it('gives 10% off at exactly 100', () => {
    expect(discountedPrice(100)).toBe(90)
  })
  it('gives 20% off at exactly 500', () => {
    expect(discountedPrice(500)).toBe(400)
  })
  it('no discount below 100', () => {
    expect(discountedPrice(99.99)).toBe(99.99)
  })
})
