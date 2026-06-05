/** @jest-environment jsdom */

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))

// Deterministic anchor measurement (jsdom has no layout).
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/document/comments/comment-gutter-dom',
  () => ({
    collectOpenCommentAnchors: (
      _dom: unknown,
      _row: unknown,
      comments: Array<{ id: string; status: string }>
    ) =>
      comments
        .filter(c => c.status === 'OPEN')
        .map((c, i) => ({ id: c.id, anchorY: i * 200 })),
  })
)

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
import { CommentGutter } from '@/app/workspace/[workspaceUrl]/components/document/comments/CommentGutter'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'

const fakeEditor = {
  view: { dom: document.createElement('div'), coordsAtPos: () => ({ top: 0 }) },
} as never

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
  onReply: jest.fn(),
  onEdit: jest.fn(),
  onDelete: jest.fn(),
  onSetStatus: jest.fn(),
  onSelectThread: jest.fn(),
}

const baseProps = {
  editor: fakeEditor,
  rowEl: document.createElement('div'),
  members: [],
  currentActorId: null,
  activeCommentId: null,
  ...cbs,
}

it('renders one positioned card per OPEN comment and skips RESOLVED', () => {
  render(
    <CommentGutter
      {...baseProps}
      comments={[comment('c1'), comment('c2', 'RESOLVED')]}
    />
  )
  expect(screen.getByTestId('thread-c1')).toBeInTheDocument()
  expect(screen.queryByTestId('thread-c2')).not.toBeInTheDocument()
})

it('positions the second card at its resolved top (200px, no overlap)', () => {
  render(
    <CommentGutter {...baseProps} comments={[comment('c1'), comment('c2')]} />
  )
  expect(screen.getByTestId('gutter-pos-c2')).toHaveStyle({ top: '200px' })
})

it('renders nothing positioned when there are no OPEN comments', () => {
  render(<CommentGutter {...baseProps} comments={[]} />)
  expect(screen.queryByTestId(/^thread-/)).not.toBeInTheDocument()
})
