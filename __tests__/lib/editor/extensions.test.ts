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

  it('threads the supplied suggestion onto the single mention node', () => {
    const extensions = getBaseExtensions({
      mentionSuggestion: { char: '@', render: () => ({}) },
    })
    expect(mentionCount(extensions)).toBe(1)
    const mention = extensions.find(e => e.name === 'mention')
    expect(
      (mention?.options as { suggestion?: { char?: string } } | undefined)
        ?.suggestion?.char
    ).toBe('@')
  })
})
