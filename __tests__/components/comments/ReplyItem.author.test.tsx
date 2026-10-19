/**
 * LUM-1238: reply rows and the quote preview inside a reply resolve their
 * author the same way as top-level comments (member → authorName → fallback).
 */
import { render, screen } from '@testing-library/react'
import { ReplyItem } from '@/app/workspace/[workspaceUrl]/components/comments/ReplyItem'
import type { ApiComment } from '@/app/workspace/[workspaceUrl]/types'

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => `t:${id}` }),
}))
jest.mock('@/components/RichHtml', () => ({
  RichHtml: ({ html }: { html: string }) => <div>{html}</div>,
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/comments/CommentActions',
  () => ({
    CommentActions: () => null,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/ContentSignalsBadge',
  () => ({
    ContentSignalsBadge: () => null,
  })
)
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useFormatDate', () => ({
  useFormatDate: () => ({ fmtTimestamp: () => 'now' }),
}))

function comment(
  over: Partial<ApiComment> & { authorName?: string | null }
): ApiComment {
  return {
    id: 'c',
    taskId: 't',
    authorActorId: null,
    body: '<p>body</p>',
    parentId: null,
    quotedCommentId: null,
    type: 'USER',
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
    ...over,
  } as ApiComment
}

const tc = {
  editingCommentId: null,
  deletingCommentId: null,
  highlightedCommentId: null,
  replyingToId: null,
} as any

function renderReply(reply: ApiComment, parent: ApiComment) {
  return render(
    <ReplyItem
      reply={reply}
      parent={parent}
      members={[]}
      agentActors={[]}
      currentActorId={null}
      workspaceUrl='lumo'
      projectName='Lumo'
      teamIdentifier='LUM'
      taskNumber={806}
      tc={tc}
    />
  )
}

describe('ReplyItem author (LUM-1238)', () => {
  it('shows authorName for the reply and for the quoted bot comment', () => {
    const quoted = comment({
      id: 'q1',
      parentId: 'p1',
      authorActorId: 'gh-vercel',
      authorName: '@vercel[bot]',
      body: '<p>deployed</p>',
    })
    const parent = comment({
      id: 'p1',
      authorActorId: 'gh-lumo',
      authorName: '@uselumo[bot]',
      replies: [quoted],
    })
    const reply = comment({
      id: 'r1',
      parentId: 'p1',
      quotedCommentId: 'q1',
      authorActorId: 'gh-lumo',
      authorName: '@uselumo[bot]',
    })
    renderReply(reply, parent)
    expect(screen.getByText('@uselumo[bot]')).toBeTruthy()
    expect(screen.getByText('@vercel[bot]')).toBeTruthy()
    expect(screen.queryByText('Unknown')).toBeNull()
  })

  it('falls back to the localized label when no name is known', () => {
    const quoted = comment({
      id: 'q1',
      parentId: 'p1',
      authorActorId: 'x',
      authorName: null,
    })
    const parent = comment({ id: 'p1', replies: [quoted] })
    const reply = comment({
      id: 'r1',
      parentId: 'p1',
      quotedCommentId: 'q1',
      authorActorId: 'y',
    })
    renderReply(reply, parent)
    expect(screen.getAllByText('t:comment.unknownAuthor')).toHaveLength(2)
    expect(screen.queryByText('Unknown')).toBeNull()
  })
})
