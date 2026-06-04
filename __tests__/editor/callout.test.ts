// __tests__/editor/callout.test.ts
// react-intl and shadcn dropdown ship untranspiled ESM; stub them so the
// callout-node-view import chain doesn't blow up in jsdom. Mirrors the pattern
// used in __tests__/editor/code-block-lowlight.test.ts.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: () => null,
  DropdownMenuTrigger: () => null,
  DropdownMenuContent: () => null,
  DropdownMenuItem: () => null,
}))

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
