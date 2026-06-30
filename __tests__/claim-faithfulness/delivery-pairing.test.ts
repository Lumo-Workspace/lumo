import { isClaimDeliveryMismatch } from '@/lib/claim-faithfulness/delivery-pairing'

describe('isClaimDeliveryMismatch', () => {
  it('flags a claim whose session has not merged while a different one has', () => {
    expect(isClaimDeliveryMismatch('sess-followup', ['sess-merged'])).toBe(true)
  })

  it('does not flag when the claim session is itself a merged delivery', () => {
    expect(
      isClaimDeliveryMismatch('sess-merged', ['sess-merged', 'sess-other'])
    ).toBe(false)
  })

  it('does not flag a legacy claim with no session pointer', () => {
    expect(isClaimDeliveryMismatch(null, ['sess-merged'])).toBe(false)
    expect(isClaimDeliveryMismatch(undefined, ['sess-merged'])).toBe(false)
  })

  it('does not flag when there are no merged deliveries yet (pre-merge)', () => {
    expect(isClaimDeliveryMismatch('sess-followup', [])).toBe(false)
  })
})
