/** @jest-environment jsdom */

// The code-block node view (reachable via getBaseExtensions) imports react-intl,
// which ships untranspiled ESM; stub it. Mirrors other component suites.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

jest.mock('@/lib/api-client/mention-status', () => ({
  mentionStatusClient: { fetch: jest.fn() },
}))

import { screen, waitFor } from '@testing-library/react'
import { renderWithQueryClient as render } from '../helpers/query-client'
import { RichTextViewer } from '@/app/workspace/[workspaceUrl]/components/RichTextViewer'
import { mentionStatusClient } from '@/lib/api-client/mention-status'

const fetchMock = mentionStatusClient.fetch as jest.Mock

// Stored doc HTML carrying one task mention (frozen snapshot status = IN_PROGRESS).
const taskMentionHtml = (status = 'IN_PROGRESS') =>
  '<p><a class="mention mention-task" data-id="5" data-label="LUM-5" ' +
  `data-mention-type="task" data-mention-title="Fix bug" data-mention-status="${status}" ` +
  'data-href="/t/5">LUM-5 Fix bug</a></p>'

describe('RichTextViewer', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    // Default: no live data — keeps the non-mention tests network-free.
    fetchMock.mockResolvedValue([])
  })

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

  it('renders stored mention HTML as chips, not plain links/text', async () => {
    const html =
      '<p>' +
      '<span class="mention mention-user" data-id="u1" data-label="Alice" data-mention-type="user">@Alice</span> ' +
      '<a class="mention mention-task" data-id="5" data-label="LUM-5" data-mention-type="task" data-mention-title="Fix bug" data-mention-status="IN_PROGRESS" data-href="/t/5">LUM-5 Fix bug</a> ' +
      '<a href="https://example.com">normal link</a>' +
      '</p>'
    const { container } = render(<RichTextViewer value={html} />)

    // Entity mention -> clickable chip anchor with the kind class + href + status.
    // (Mention chips now render through a React node-view portal, so await it.)
    await waitFor(() =>
      expect(container.querySelector('a.mention.mention-task')).not.toBeNull()
    )
    const taskChip = container.querySelector('a.mention.mention-task')
    expect(taskChip?.getAttribute('data-href')).toBe('/t/5')
    expect(taskChip?.getAttribute('data-mention-status')).toBe('IN_PROGRESS')

    // User mention -> highlighted span chip (not bare text).
    expect(container.querySelector('span.mention.mention-user')).not.toBeNull()

    // A real link is still a plain link, not a mention chip.
    const plain = container.querySelector('a[href="https://example.com"]')
    expect(plain).not.toBeNull()
    expect(plain?.classList.contains('mention')).toBe(false)
  })

  it('renders a live status badge from the current status, not the frozen snapshot', async () => {
    // Stored snapshot says IN_PROGRESS; the live lookup says DONE.
    fetchMock.mockResolvedValue([
      { identifier: 'LUM-5', status: 'DONE', pr: 'none' },
    ])
    const { container } = render(
      <RichTextViewer value={taskMentionHtml('IN_PROGRESS')} />
    )

    await waitFor(() =>
      expect(
        container.querySelector('[data-live-status="DONE"]')
      ).not.toBeNull()
    )
    // The stale snapshot status is never the one shown as a live badge.
    expect(
      container.querySelector('[data-live-status="IN_PROGRESS"]')
    ).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(['LUM-5'])
    // The chip itself still renders.
    expect(screen.getByText(/Fix bug/)).toBeInTheDocument()
  })

  it('renders a PR badge when the task has an open or merged PR', async () => {
    fetchMock.mockResolvedValue([
      { identifier: 'LUM-5', status: 'IN_REVIEW', pr: 'open' },
    ])
    const { container } = render(<RichTextViewer value={taskMentionHtml()} />)

    await waitFor(() =>
      expect(container.querySelector('[data-pr-state="open"]')).not.toBeNull()
    )
  })

  it('omits the PR badge (status badge only) when the task has no PR', async () => {
    fetchMock.mockResolvedValue([
      { identifier: 'LUM-5', status: 'TODO', pr: 'none' },
    ])
    const { container } = render(<RichTextViewer value={taskMentionHtml()} />)

    await waitFor(() =>
      expect(
        container.querySelector('[data-live-status="TODO"]')
      ).not.toBeNull()
    )
    expect(container.querySelector('[data-pr-state]')).toBeNull()
  })

  it('mention degrades to a plain chip when the live status is unavailable', async () => {
    // Identifier not returned (unknown / not visible).
    fetchMock.mockResolvedValue([])
    const { container } = render(<RichTextViewer value={taskMentionHtml()} />)

    // Chip still renders (via the node-view portal); just no live badge.
    await waitFor(() =>
      expect(container.querySelector('a.mention.mention-task')).not.toBeNull()
    )
    expect(fetchMock).toHaveBeenCalled()
    expect(container.querySelector('[data-live-status]')).toBeNull()
    expect(screen.getByText(/Fix bug/)).toBeInTheDocument()
  })

  it('mention degrades without throwing when the live lookup fails', async () => {
    fetchMock.mockRejectedValue(new Error('boom'))
    const { container } = render(<RichTextViewer value={taskMentionHtml()} />)

    await waitFor(() =>
      expect(container.querySelector('a.mention.mention-task')).not.toBeNull()
    )
    expect(fetchMock).toHaveBeenCalled()
    expect(container.querySelector('[data-live-status]')).toBeNull()
  })
})
