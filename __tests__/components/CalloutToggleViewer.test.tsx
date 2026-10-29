// __tests__/components/CalloutToggleViewer.test.tsx
/** @jest-environment jsdom */

// NodeViews import react-intl (untranspiled ESM); stub it. Mirrors the
// existing RichTextViewer suite.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

import { screen, waitFor } from '@testing-library/react'
import { renderWithQueryClient as render } from '../helpers/query-client'
import { RichTextViewer } from '@/app/workspace/[workspaceUrl]/components/RichTextViewer'

// Tiptap ReactNodeViewRenderer populates node view containers via
// ReactDOM.createPortal inside an EditorContent setState cycle that runs after
// the initial render.  waitFor() drains those async state updates before
// asserting on node-view-rendered DOM.

describe('RichTextViewer — callout & toggle', () => {
  it('renders a stored callout with its body and derived emoji', async () => {
    const { container } = render(
      <RichTextViewer value='<div data-callout data-variant="warning"><p>be careful</p></div>' />
    )
    await waitFor(() =>
      expect(screen.getByText('be careful')).toBeInTheDocument()
    )
    const callout = container.querySelector(
      '[data-callout][data-variant="warning"]'
    )
    expect(callout).not.toBeNull()
    // Emoji is derived from the variant, not stored in the HTML.
    expect(container.textContent).toContain('⚠️')
  })

  it('defaults an unknown variant to info', async () => {
    const { container } = render(
      <RichTextViewer value='<div data-callout data-variant="bogus"><p>hi</p></div>' />
    )
    await waitFor(() =>
      expect(
        container.querySelector('[data-callout][data-variant="info"]')
      ).not.toBeNull()
    )
    expect(container.textContent).toContain('💡')
  })

  it('renders a stored toggle: summary always visible, body present, open persisted', async () => {
    const { container } = render(
      <RichTextViewer value='<div data-toggle data-open="true"><div data-toggle-summary>Details</div><div data-toggle-content><p>hidden body</p></div></div>' />
    )
    await waitFor(() => expect(screen.getByText('Details')).toBeInTheDocument())
    expect(screen.getByText('hidden body')).toBeInTheDocument()
    expect(
      container.querySelector('[data-toggle][data-open="true"]')
    ).not.toBeNull()
  })

  it('preserves a collapsed toggle (data-open="false") on round-trip', async () => {
    const { container } = render(
      <RichTextViewer value='<div data-toggle data-open="false"><div data-toggle-summary>Closed</div><div data-toggle-content><p>body</p></div></div>' />
    )
    await waitFor(() =>
      expect(
        container.querySelector('[data-toggle][data-open="false"]')
      ).not.toBeNull()
    )
  })
})
