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

import { act, render, screen } from '@testing-library/react'
import { CommentGutter } from '@/app/workspace/[workspaceUrl]/components/document/comments/CommentGutter'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'

// jsdom has no ResizeObserver and no layout; this mock lets a test drive
// measured card heights deterministically via flush().
class MockResizeObserver {
  static instances: MockResizeObserver[] = []
  private cb: ResizeObserverCallback
  private els: Element[] = []
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
    MockResizeObserver.instances.push(this)
  }
  observe(el: Element) {
    this.els.push(el)
  }
  unobserve(el: Element) {
    this.els = this.els.filter(e => e !== el)
  }
  disconnect() {
    this.els = []
  }
  flush() {
    this.cb(
      this.els.map(el => ({ target: el }) as ResizeObserverEntry),
      this as unknown as ResizeObserver
    )
  }
}

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

it('reserves each card’s measured height so a tall card pushes the next down', () => {
  const orig = global.ResizeObserver
  global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
  MockResizeObserver.instances = []
  try {
    render(
      <CommentGutter {...baseProps} comments={[comment('c1'), comment('c2')]} />
    )
    // c1's anchor is 0, c2's is 200. With a tall c1 (a thread with replies),
    // c2 must clear c1's real bottom, not the old fixed 96px estimate.
    const c1 = screen.getByTestId('gutter-pos-c1')
    Object.defineProperty(c1, 'offsetHeight', {
      value: 250,
      configurable: true,
    })
    act(() => {
      MockResizeObserver.instances.forEach(i => i.flush())
    })
    // c1 occupies 0..250, so c2 (anchor 200) is pushed to 250 + gap(8) = 258.
    expect(screen.getByTestId('gutter-pos-c2')).toHaveStyle({ top: '258px' })
  } finally {
    global.ResizeObserver = orig
  }
})
