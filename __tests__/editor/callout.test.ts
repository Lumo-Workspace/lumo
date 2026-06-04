// __tests__/editor/callout.test.ts
import {
  Callout,
  calloutAttributesForVariant,
} from '@/lib/editor/nodes/callout'

describe('Callout node', () => {
  it('is a Tiptap node named "callout"', () => {
    expect(Callout.name).toBe('callout')
  })

  it('renders the variant as a data-variant attribute (no emoji in HTML)', () => {
    expect(calloutAttributesForVariant('warning')).toEqual({
      'data-variant': 'warning',
    })
  })

  it('normalizes unknown variants to info on render', () => {
    expect(calloutAttributesForVariant('bogus')).toEqual({
      'data-variant': 'info',
    })
  })
})
