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
      thread: { id: string; status: string }
      active?: boolean
    }) => (
      <div
        data-testid={`thread-${thread.id}`}
        data-active={active ? 'true' : undefined}
      >
        {thread.status}
      </div>
    ),
  })
)

import { render, screen, fireEvent } from '@testing-library/react'
import { DocumentCommentsSidebar } from '@/app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentsSidebar'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'

const baseCallbacks = {
  onReply: jest.fn(),
  onEdit: jest.fn(),
  onDelete: jest.fn(),
  onSetStatus: jest.fn(),
  onSelectThread: jest.fn(),
}

const openComment: ApiDocumentComment = {
  id: 'c1',
  documentId: 'd1',
  authorActorId: null,
  body: '<p>looks good</p>',
  parentId: null,
  quotedText: 'the intro',
  anchorStart: 1,
  anchorEnd: 5,
  status: 'OPEN',
  isOrphaned: false,
  type: 'USER',
  createdAt: '2026-06-04T00:00:00Z',
  replies: [],
}

const resolvedComment: ApiDocumentComment = {
  ...openComment,
  id: 'c2',
  status: 'RESOLVED',
}

it('renders empty state when no comments', () => {
  render(
    <DocumentCommentsSidebar
      comments={[]}
      members={[]}
      agentActors={[]}
      currentActorId={null}
      {...baseCallbacks}
    />
  )
  expect(screen.getByText('document.noComments')).toBeInTheDocument()
})

it('renders an OPEN thread by default', () => {
  render(
    <DocumentCommentsSidebar
      comments={[openComment]}
      members={[]}
      agentActors={[]}
      currentActorId={null}
      {...baseCallbacks}
    />
  )
  expect(screen.getByTestId('thread-c1')).toBeInTheDocument()
})

it('hides RESOLVED threads by default and shows them after toggling', () => {
  render(
    <DocumentCommentsSidebar
      comments={[openComment, resolvedComment]}
      members={[]}
      agentActors={[]}
      currentActorId={null}
      {...baseCallbacks}
    />
  )

  // OPEN visible, RESOLVED hidden by default
  expect(screen.getByTestId('thread-c1')).toBeInTheDocument()
  expect(screen.queryByTestId('thread-c2')).not.toBeInTheDocument()

  // Toggle show-resolved
  fireEvent.click(screen.getByTestId('show-resolved-toggle'))

  // Both visible after toggle
  expect(screen.getByTestId('thread-c1')).toBeInTheDocument()
  expect(screen.getByTestId('thread-c2')).toBeInTheDocument()
})

it('passes active=true only to the thread matching activeCommentId', () => {
  render(
    <DocumentCommentsSidebar
      comments={[openComment, { ...openComment, id: 'c2', status: 'OPEN' }]}
      members={[]}
      agentActors={[]}
      currentActorId={null}
      activeCommentId='c1'
      {...baseCallbacks}
    />
  )

  expect(screen.getByTestId('thread-c1')).toHaveAttribute('data-active', 'true')
  expect(screen.getByTestId('thread-c2')).not.toHaveAttribute('data-active')
})
