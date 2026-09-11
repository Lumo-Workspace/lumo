/** @jest-environment node */
import { aggregateSuggestionPrecision } from '../aggregate'

const row = (over: object) => ({
  suggestedDisposition: 'FALSE_POSITIVE',
  disposition: null,
  suggestionOutcome: null,
  ...over,
})

describe('LUM-740 suggestion precision aggregate', () => {
  it('counts suggested / confirmed / overruled / pending and computes precision', () => {
    const stats = aggregateSuggestionPrecision([
      row({ disposition: 'FALSE_POSITIVE', suggestionOutcome: 'CONFIRMED' }),
      row({ disposition: 'FALSE_POSITIVE', suggestionOutcome: 'CONFIRMED' }),
      row({ disposition: 'ACCEPTED_RISK', suggestionOutcome: 'OVERRULED' }),
      row({}),
      // Not suggested at all: never counted.
      row({ suggestedDisposition: null, disposition: 'FALSE_POSITIVE' }),
    ])
    expect(stats).toEqual({
      suggested: 4,
      confirmed: 2,
      overruled: 1,
      pending: 1,
      precision: 2 / 3,
    })
  })

  it('precision is null until a human has decided at least once', () => {
    expect(aggregateSuggestionPrecision([row({}), row({})])).toEqual({
      suggested: 2,
      confirmed: 0,
      overruled: 0,
      pending: 2,
      precision: null,
    })
    expect(aggregateSuggestionPrecision([])).toMatchObject({
      suggested: 0,
      precision: null,
    })
  })
})
