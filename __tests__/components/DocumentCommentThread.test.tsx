/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react'
import { DocumentCommentThread } from '@/app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentThread'

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/comments/CommentEditor',
  () => ({
    CommentEditor: ({ onCommit }: { onCommit: (h: string) => void }) => {
      onCommit('typed body')
      return <div data-testid='composer' />
    },
  })
)

const base = {
  id: 'c1',
  documentId: 'd1',
  authorActorId: 'a1',
  body: '<p>top</p>',
  parentId: null,
  quotedText: 'intro',
  anchorStart: 1,
  anchorEnd: 5,
  status: 'OPEN',
  isOrphaned: false,
  type: 'USER',
  createdAt: '2026-06-04T00:00:00Z',
  replies: [],
}
function r(props = {}) {
  return render(
    <DocumentCommentThread
      thread={base as never}
      members={[]}
      agentActors={[]}
      currentActorId='a1'
      onReply={jest.fn()}
      onEdit={jest.fn()}
      onDelete={jest.fn()}
      onSetStatus={jest.fn()}
      onSelect={jest.fn()}
      {...props}
    />
  )
}

it('renders quoted text + body', () => {
  r()
  expect(screen.getByText(/intro/)).toBeInTheDocument()
  expect(screen.getByText(/top/)).toBeInTheDocument()
})

it('shows orphaned label when isOrphaned', () => {
  r({ thread: { ...base, isOrphaned: true } })
  expect(screen.getByText('document.commentOrphaned')).toBeInTheDocument()
})

it('toggles resolve via onSetStatus', () => {
  const onSetStatus = jest.fn()
  r({ onSetStatus })
  fireEvent.click(screen.getByTestId('resolve-toggle'))
  expect(onSetStatus).toHaveBeenCalledWith('c1', 'RESOLVED')
})

it('reopens when already resolved', () => {
  const onSetStatus = jest.fn()
  r({ thread: { ...base, status: 'RESOLVED' }, onSetStatus })
  fireEvent.click(screen.getByTestId('resolve-toggle'))
  expect(onSetStatus).toHaveBeenCalledWith('c1', 'OPEN')
})

it('submits a reply', () => {
  const onReply = jest.fn()
  r({ onReply })
  fireEvent.click(screen.getByTestId('reply-btn'))
  fireEvent.click(screen.getByTestId('reply-submit'))
  expect(onReply).toHaveBeenCalledWith('c1', 'typed body')
})

it('hides edit/delete for non-authors', () => {
  r({ currentActorId: 'someone-else' })
  expect(screen.queryByTestId('edit-c1')).toBeNull()
  expect(screen.queryByTestId('delete-c1')).toBeNull()
})

it('renders a deleted parent as a tombstone with its replies, no edit/delete', () => {
  r({
    thread: {
      ...base,
      deletedAt: '2026-06-05T00:00:00Z',
      body: '<p>top</p>',
      replies: [
        {
          ...base,
          id: 'r1',
          parentId: 'c1',
          body: '<p>still here</p>',
          deletedAt: null,
          replies: [],
        },
      ],
    },
  })
  // Tombstone placeholder shown instead of the original body.
  expect(screen.getByText('document.commentDeleted')).toBeInTheDocument()
  expect(screen.queryByText(/^top$/)).toBeNull()
  // Reply remains visible.
  expect(screen.getByText(/still here/)).toBeInTheDocument()
  // Author actions are gone on the deleted row.
  expect(screen.queryByTestId('edit-c1')).toBeNull()
  expect(screen.queryByTestId('delete-c1')).toBeNull()
})

it('calls onDelete after confirmation (author)', () => {
  const onDelete = jest.fn()
  r({ onDelete })
  fireEvent.click(screen.getByTestId('delete-c1')) // arm confirm
  expect(onDelete).not.toHaveBeenCalled()
  fireEvent.click(screen.getByTestId('confirm-delete-c1'))
  expect(onDelete).toHaveBeenCalledWith('c1')
})
it('cancels delete without calling onDelete', () => {
  const onDelete = jest.fn()
  r({ onDelete })
  fireEvent.click(screen.getByTestId('delete-c1'))
  fireEvent.click(screen.getByTestId('cancel-delete-c1'))
  expect(onDelete).not.toHaveBeenCalled()
})
