/** @jest-environment jsdom */

// getBaseExtensions transitively imports the code-block node view, which pulls
// in react-intl (untranspiled ESM). Stub it, mirroring RichTextViewer.test.tsx.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

import { getBaseExtensions } from '@/lib/editor/extensions'

function mentionCount(extensions: ReturnType<typeof getBaseExtensions>) {
  return extensions.filter(e => e.name === 'mention').length
}

describe('getBaseExtensions mention node', () => {
  it('includes exactly one mention node with no arguments', () => {
    expect(mentionCount(getBaseExtensions())).toBe(1)
  })

  it('includes exactly one mention node when a suggestion is supplied', () => {
    const extensions = getBaseExtensions({
      mentionSuggestion: { char: '@', render: () => ({}) },
    })
    expect(mentionCount(extensions)).toBe(1)
  })
})
