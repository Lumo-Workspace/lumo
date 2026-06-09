/** @jest-environment jsdom */

// The code-block node view (reachable via getBaseExtensions) imports react-intl,
// which ships untranspiled ESM; stub it. Mirrors other component suites.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

import { render, screen } from '@testing-library/react'
import { RichTextViewer } from '@/app/workspace/[workspaceUrl]/components/RichTextViewer'

describe('RichTextViewer', () => {
  it('renders the supplied HTML content', () => {
    render(<RichTextViewer value='<p>hello world</p>' />)
    expect(screen.getByText('hello world')).toBeInTheDocument()
  })

  it('renders read-only (the ProseMirror surface is not editable)', () => {
    const { container } = render(<RichTextViewer value='<p>read only</p>' />)
    const editable = container.querySelector('[contenteditable]')
    // Tiptap reflects `editable: false` as contenteditable="false".
    expect(editable?.getAttribute('contenteditable')).toBe('false')
  })

  it('renders nothing visible for null content without crashing', () => {
    const { container } = render(<RichTextViewer value={null} />)
    expect(container.textContent).toBe('')
  })

  it('renders stored mention HTML as chips, not plain links/text', () => {
    const html =
      '<p>' +
      '<span class="mention mention-user" data-id="u1" data-label="Alice" data-mention-type="user">@Alice</span> ' +
      '<a class="mention mention-task" data-id="5" data-label="LUM-5" data-mention-type="task" data-mention-title="Fix bug" data-mention-status="IN_PROGRESS" data-href="/t/5">LUM-5 Fix bug</a> ' +
      '<a href="https://example.com">normal link</a>' +
      '</p>'
    const { container } = render(<RichTextViewer value={html} />)

    // Entity mention -> clickable chip anchor with the kind class + href + status.
    const taskChip = container.querySelector('a.mention.mention-task')
    expect(taskChip).not.toBeNull()
    expect(taskChip?.getAttribute('data-href')).toBe('/t/5')
    expect(taskChip?.getAttribute('data-mention-status')).toBe('IN_PROGRESS')

    // User mention -> highlighted span chip (not bare text).
    expect(container.querySelector('span.mention.mention-user')).not.toBeNull()

    // A real link is still a plain link, not a mention chip.
    const plain = container.querySelector('a[href="https://example.com"]')
    expect(plain).not.toBeNull()
    expect(plain?.classList.contains('mention')).toBe(false)
  })
})
