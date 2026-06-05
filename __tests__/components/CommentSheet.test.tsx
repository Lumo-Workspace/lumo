/** @jest-environment jsdom */

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))

// Radix Dialog (Sheet) is unreliable in jsdom; stub the primitives to render
// content inline when `open`, so the test exercises CommentSheet's own logic.
jest.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid='sheet'>{children}</div> : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
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

import { render, screen } from '@testing-library/react'
import { CommentSheet } from '@/app/workspace/[workspaceUrl]/components/document/comments/CommentSheet'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'

const comment = (
  id: string,
  status: 'OPEN' | 'RESOLVED' = 'OPEN'
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

const cbs = {
  onOpenChange: jest.fn(),
  onReply: jest.fn(),
  onEdit: jest.fn(),
  onDelete: jest.fn(),
  onSetStatus: jest.fn(),
  onSelectThread: jest.fn(),
}

const baseProps = {
  members: [],
  currentActorId: null,
  activeCommentId: null,
  ...cbs,
}

it('renders nothing when closed', () => {
  render(
    <CommentSheet {...baseProps} open={false} comments={[comment('c1')]} />
  )
  expect(screen.queryByTestId('sheet')).not.toBeInTheDocument()
})

it('lists OPEN threads and hides RESOLVED when open', () => {
  render(
    <CommentSheet
      {...baseProps}
      open
      comments={[comment('c1'), comment('c2', 'RESOLVED')]}
    />
  )
  expect(screen.getByTestId('thread-c1')).toBeInTheDocument()
  expect(screen.queryByTestId('thread-c2')).not.toBeInTheDocument()
})

it('shows the empty state when there are no OPEN comments', () => {
  render(
    <CommentSheet {...baseProps} open comments={[comment('c1', 'RESOLVED')]} />
  )
  expect(screen.getByText('document.noComments')).toBeInTheDocument()
  expect(screen.queryByTestId(/^thread-/)).not.toBeInTheDocument()
})

it('marks the active thread', () => {
  render(
    <CommentSheet
      {...baseProps}
      open
      activeCommentId='c1'
      comments={[comment('c1')]}
    />
  )
  expect(screen.getByTestId('thread-c1')).toHaveAttribute('data-active', 'true')
})
