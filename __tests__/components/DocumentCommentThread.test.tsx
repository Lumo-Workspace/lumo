/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react'
import { DocumentCommentThread } from '@/app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentThread'

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useFormatDate', () => ({
  useFormatDate: () => ({ fmtTimestamp: () => '2h ago' }),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/comments/CommentEditor',
  () => ({
    CommentEditor: ({
      onCommit,
      placeholderId,
    }: {
      onCommit: (h: string) => void
      placeholderId?: string
    }) => {
      onCommit('typed body')
      return <div data-testid='composer' data-placeholder={placeholderId} />
    },
  })
)
// Stub the rich-text edit block — its tiptap editor can't mount in jsdom.
// We only need its Cancel/Confirm wiring for the cancelable-edit test.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/comments/CommentEditMode',
  () => ({
    CommentEditMode: ({
      onCancel,
      onSave,
    }: {
      onCancel: () => void
      onSave: () => void
    }) => (
      <div data-testid='edit-mode'>
        <button onClick={onCancel}>common.cancel</button>
        <button onClick={onSave}>common.confirm</button>
      </div>
    ),
  })
)

// jsdom has no PointerEvent, so fireEvent.pointerDown would drop `button`
// and the Radix DropdownMenu trigger (which opens on pointerdown) ignores it.
if (typeof window.PointerEvent === 'undefined') {
  window.PointerEvent = class extends MouseEvent {} as typeof PointerEvent
}

// Radix DropdownMenu opens on pointerdown (not click).
function openMenu() {
  fireEvent.pointerDown(screen.getByTestId('comment-menu-c1'), {
    button: 0,
    ctrlKey: false,
  })
}

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
const members = [{ actorId: 'a1', name: 'Chao Li', imageUrl: null }]
function r(props = {}) {
  return render(
    <DocumentCommentThread
      thread={base as never}
      members={members as never}
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

it('renders author name and timestamp in the header', () => {
  r()
  expect(screen.getByText('Chao Li')).toBeInTheDocument()
  expect(screen.getByText(/2h ago/)).toBeInTheDocument()
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

it('hides the reply toggle while composing (no duplicate Reply)', () => {
  r()
  fireEvent.click(screen.getByTestId('reply-btn'))
  // The toggle link is gone — only the submit button reads 回复 now.
  expect(screen.queryByTestId('reply-btn')).toBeNull()
  expect(screen.getByTestId('reply-cancel')).toBeInTheDocument()
  expect(screen.getByTestId('reply-submit')).toBeInTheDocument()
})

it('cancel collapses the composer and restores the toggle', () => {
  const onReply = jest.fn()
  r({ onReply })
  fireEvent.click(screen.getByTestId('reply-btn'))
  fireEvent.click(screen.getByTestId('reply-cancel'))
  expect(onReply).not.toHaveBeenCalled()
  expect(screen.getByTestId('reply-btn')).toBeInTheDocument()
  expect(screen.queryByTestId('reply-submit')).toBeNull()
})

it('reply composer uses the reply placeholder, not the comment one', () => {
  r()
  fireEvent.click(screen.getByTestId('reply-btn'))
  expect(screen.getByTestId('composer')).toHaveAttribute(
    'data-placeholder',
    'task.replyPlaceholder'
  )
})

it('edit/delete live behind a kebab menu, hidden until opened', () => {
  r()
  // Collapsed by default — no edit/delete in the DOM yet.
  expect(screen.queryByTestId('edit-c1')).toBeNull()
  expect(screen.queryByTestId('delete-c1')).toBeNull()
  // Open the menu → both actions appear.
  openMenu()
  expect(screen.getByTestId('edit-c1')).toBeInTheDocument()
  expect(screen.getByTestId('delete-c1')).toBeInTheDocument()
})

it('hides the menu (and edit/delete) for non-authors', () => {
  r({ currentActorId: 'someone-else' })
  expect(screen.queryByTestId('comment-menu-c1')).toBeNull()
  expect(screen.queryByTestId('edit-c1')).toBeNull()
  expect(screen.queryByTestId('delete-c1')).toBeNull()
})

it('opens the cancelable editor from the menu', () => {
  r()
  openMenu()
  fireEvent.click(screen.getByTestId('edit-c1'))
  expect(screen.getByTestId('edit-mode')).toBeInTheDocument()
})

it('edit mode is cancelable — Cancel returns to read-only without saving', () => {
  const onEdit = jest.fn()
  r({ onEdit })
  openMenu()
  fireEvent.click(screen.getByTestId('edit-c1'))
  expect(screen.getByText('common.cancel')).toBeInTheDocument()
  fireEvent.click(screen.getByText('common.cancel'))
  // Back to read-only: editor gone, nothing was saved.
  expect(screen.queryByTestId('edit-mode')).toBeNull()
  expect(onEdit).not.toHaveBeenCalled()
})

it('renders a deleted parent as a tombstone with its replies, no menu', () => {
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
  expect(screen.queryByTestId('comment-menu-c1')).toBeNull()
})

it('calls onDelete after confirmation (author)', () => {
  const onDelete = jest.fn()
  r({ onDelete })
  openMenu() // open menu
  fireEvent.click(screen.getByTestId('delete-c1')) // arm confirm
  expect(onDelete).not.toHaveBeenCalled()
  fireEvent.click(screen.getByTestId('confirm-delete-c1'))
  expect(onDelete).toHaveBeenCalledWith('c1')
})

it('drops the delete confirm/cancel once the comment becomes a tombstone', () => {
  const { rerender } = r()
  openMenu()
  fireEvent.click(screen.getByTestId('delete-c1'))
  expect(screen.getByTestId('confirm-delete-c1')).toBeInTheDocument()
  // The delete lands: the parent (with live replies) becomes a tombstone.
  rerender(
    <DocumentCommentThread
      thread={{ ...base, deletedAt: '2026-06-05T00:00:00Z' } as never}
      members={members as never}
      agentActors={[]}
      currentActorId='a1'
      onReply={jest.fn()}
      onEdit={jest.fn()}
      onDelete={jest.fn()}
      onSetStatus={jest.fn()}
      onSelect={jest.fn()}
    />
  )
  expect(screen.queryByTestId('confirm-delete-c1')).toBeNull()
  expect(screen.queryByTestId('cancel-delete-c1')).toBeNull()
  expect(screen.getByText('document.commentDeleted')).toBeInTheDocument()
})

it('cancels delete without calling onDelete', () => {
  const onDelete = jest.fn()
  r({ onDelete })
  openMenu()
  fireEvent.click(screen.getByTestId('delete-c1'))
  fireEvent.click(screen.getByTestId('cancel-delete-c1'))
  expect(onDelete).not.toHaveBeenCalled()
})
