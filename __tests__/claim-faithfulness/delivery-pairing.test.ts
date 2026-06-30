import {
  hasDeliveryGrown,
  isClaimDeliveryMismatch,
} from '@/lib/claim-faithfulness/delivery-pairing'

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

describe('hasDeliveryGrown', () => {
  it('flags growth when a newly-merged PR is absent from the judged set', () => {
    // LUM-617: judged against [761], task now has [761, 762].
    expect(hasDeliveryGrown([761, 762], [761])).toBe(true)
  })

  it('flags growth from an empty judged set once any delivery merges', () => {
    expect(hasDeliveryGrown([700], [])).toBe(true)
  })

  it('does not flag when the current set is unchanged', () => {
    expect(hasDeliveryGrown([761, 762], [762, 761])).toBe(false)
  })

  it('does not flag when the current set is a subset of the judged set', () => {
    // Never happens (merged PRs are monotonic) but must not force a re-judge.
    expect(hasDeliveryGrown([761], [761, 762])).toBe(false)
  })

  it('does not flag when there are no merged PRs', () => {
    expect(hasDeliveryGrown([], [])).toBe(false)
  })
})
