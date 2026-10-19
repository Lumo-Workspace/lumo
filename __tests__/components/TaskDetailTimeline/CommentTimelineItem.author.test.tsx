/**
 * LUM-1238: a PR-mirrored bot comment in the activity timeline shows the
 * API's authorName, not a fallback.
 */
import { render, screen } from '@testing-library/react'
import { CommentTimelineItem } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/items/CommentTimelineItem'
import type { TimelineCommentEntry } from '@/app/workspace/[workspaceUrl]/types'

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => `t:${id}` }),
}))
jest.mock('@/components/RichHtml', () => ({
  RichHtml: ({ html }: { html: string }) => <div>{html}</div>,
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useFormatDate', () => ({
  useFormatDate: () => ({ fmtTimestamp: () => 'now' }),
}))

const entry = (authorName: string | null): TimelineCommentEntry => ({
  id: 'c1',
  kind: 'comment',
  body: '<p>scan</p>',
  authorActorId: 'gh-bot',
  authorName,
  parentId: null,
  quotedCommentId: null,
  type: 'USER',
  createdAt: '2026-10-18T00:00:00.000Z',
  updatedAt: '2026-10-18T00:00:00.000Z',
})

describe('CommentTimelineItem author (LUM-1238)', () => {
  it('shows authorName for a non-member bot actor', () => {
    render(
      <CommentTimelineItem
        entry={entry('@vercel[bot]')}
        members={[]}
        agentActors={[]}
      />
    )
    expect(screen.getByText('@vercel[bot]')).toBeTruthy()
  })

  it('falls back to the localized label when authorName is null', () => {
    render(
      <CommentTimelineItem entry={entry(null)} members={[]} agentActors={[]} />
    )
    expect(screen.getByText('t:comment.unknownAuthor')).toBeTruthy()
  })
})
