/** @jest-environment jsdom */

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))

// Mock CommentAvatar — it uses Avatar/AvatarImage which need a DOM env; keep it
// simple here as the rendering logic isn't what we test.
jest.mock('@/app/workspace/[workspaceUrl]/components/CommentAvatar', () => ({
  CommentAvatar: ({ initials }: { initials: string }) => (
    <span data-testid='comment-avatar'>{initials}</span>
  ),
}))

import { render, screen } from '@testing-library/react'
import { DocumentCommentsSidebar } from '@/app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentsSidebar'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'

const baseComment: ApiDocumentComment = {
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

it('renders empty state', () => {
  render(
    <DocumentCommentsSidebar
      comments={[]}
      members={[]}
      agentActors={[]}
      currentActorId={null}
    />
  )
  expect(screen.getByText('document.noComments')).toBeInTheDocument()
})

it('renders a thread with quoted text + body', () => {
  render(
    <DocumentCommentsSidebar
      comments={[baseComment]}
      members={[]}
      agentActors={[]}
      currentActorId={null}
    />
  )
  expect(screen.getByText(/the intro/)).toBeInTheDocument()
  expect(screen.getByText(/looks good/)).toBeInTheDocument()
})

it('shows reply count when replies exist', () => {
  const withReplies: ApiDocumentComment = {
    ...baseComment,
    replies: [{ ...baseComment, id: 'r1', parentId: 'c1', quotedText: null }],
  }
  render(
    <DocumentCommentsSidebar
      comments={[withReplies]}
      members={[]}
      agentActors={[]}
      currentActorId={null}
    />
  )
  // The reply-count div renders "1 document.replies" split across text nodes
  const replyDiv = screen.getByText(
    (_, el) => el?.textContent?.trim() === '1 document.replies'
  )
  expect(replyDiv).toBeInTheDocument()
})

it('does not render quoted text section when quotedText is null', () => {
  const noQuote: ApiDocumentComment = { ...baseComment, quotedText: null }
  render(
    <DocumentCommentsSidebar
      comments={[noQuote]}
      members={[]}
      agentActors={[]}
      currentActorId={null}
    />
  )
  // Body still renders
  expect(screen.getByText(/looks good/)).toBeInTheDocument()
  // No blockquote div
  expect(screen.queryByText(/the intro/)).not.toBeInTheDocument()
})
