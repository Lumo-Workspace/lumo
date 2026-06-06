/** @jest-environment jsdom */

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentThread',
  () => ({
    DocumentCommentThread: ({
      thread,
      active,
    }: {
      thread: { id: string }
      active?: boolean
    }) => (
      <div
        data-testid={`thread-${thread.id}`}
        data-active={active ? 'true' : undefined}
      />
    ),
  })
)

import { render, screen, fireEvent } from '@testing-library/react'
import { CommentResolvedSection } from '@/app/workspace/[workspaceUrl]/components/document/comments/CommentResolvedSection'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'

const comment = (
  id: string,
  status: 'OPEN' | 'RESOLVED' = 'RESOLVED'
): ApiDocumentComment => ({
  id,
  documentId: 'd1',
  authorActorId: null,
  body: '<p>x</p>',
  parentId: null,
  quotedText: 'q',
  anchorStart: 1,
  anchorEnd: 2,
  status,
  isOrphaned: false,
  type: 'USER',
  createdAt: '2026-06-05T00:00:00Z',
  replies: [],
})

const baseProps = {
  members: [],
  currentActorId: null,
  activeCommentId: null,
  onReply: jest.fn(),
  onEdit: jest.fn(),
  onDelete: jest.fn(),
  onSetStatus: jest.fn(),
  onSelectThread: jest.fn(),
}

it('renders nothing when there are no resolved comments', () => {
  const { container } = render(
    <CommentResolvedSection {...baseProps} comments={[comment('c1', 'OPEN')]} />
  )
  expect(container).toBeEmptyDOMElement()
})

it('shows a collapsed toggle and hides resolved threads by default', () => {
  render(
    <CommentResolvedSection
      {...baseProps}
      comments={[comment('r1'), comment('r2'), comment('o1', 'OPEN')]}
    />
  )
  const toggle = screen.getByTestId('resolved-section-toggle')
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  // Count reflects only RESOLVED comments.
  expect(toggle).toHaveTextContent('(2)')
  expect(screen.queryByTestId(/^thread-/)).not.toBeInTheDocument()
})

it('reveals resolved threads when expanded', () => {
  render(
    <CommentResolvedSection
      {...baseProps}
      comments={[comment('r1'), comment('o1', 'OPEN')]}
    />
  )
  fireEvent.click(screen.getByTestId('resolved-section-toggle'))
  expect(screen.getByTestId('resolved-section-toggle')).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  expect(screen.getByTestId('thread-r1')).toBeInTheDocument()
  // The open comment is never listed here.
  expect(screen.queryByTestId('thread-o1')).not.toBeInTheDocument()
})

it('marks the active resolved thread once expanded', () => {
  render(
    <CommentResolvedSection
      {...baseProps}
      activeCommentId='r1'
      comments={[comment('r1')]}
    />
  )
  fireEvent.click(screen.getByTestId('resolved-section-toggle'))
  expect(screen.getByTestId('thread-r1')).toHaveAttribute('data-active', 'true')
})
