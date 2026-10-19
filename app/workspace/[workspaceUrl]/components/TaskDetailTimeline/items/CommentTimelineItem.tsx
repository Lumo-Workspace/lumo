'use client'

import { useIntl } from 'react-intl'
import type { TimelineCommentEntry, WorkspaceMemberInfo } from '../../../types'
import { CommentAvatar } from '../../CommentAvatar'
import { resolveCommentAuthor } from '../../comment-utils'
import { useFormatDate } from '../../../hooks/useFormatDate'
import { RichHtml } from '@/components/RichHtml'

interface CommentTimelineItemProps {
  entry: TimelineCommentEntry
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
}

export function CommentTimelineItem({
  entry,
  members,
  agentActors,
}: CommentTimelineItemProps) {
  const intl = useIntl()
  const { fmtTimestamp } = useFormatDate()
  const ca = resolveCommentAuthor(
    entry,
    members,
    agentActors,
    intl.formatMessage({ id: 'comment.unknownAuthor' })
  )

  return (
    <div className='flex gap-2.5 py-2'>
      <CommentAvatar
        isAgent={ca.isAgent}
        imageUrl={ca.imageUrl}
        initials={ca.initials}
      />
      <div className='flex-1 min-w-0'>
        <div className='flex items-baseline gap-2 mb-1'>
          <span className='text-caption font-semibold text-foreground'>
            {ca.name}
          </span>
          <span className='text-caption text-muted-foreground'>
            {fmtTimestamp(entry.createdAt)}
          </span>
        </div>
        <RichHtml
          className='prose prose-sm dark:prose-invert max-w-none text-foreground'
          html={entry.body}
        />
      </div>
    </div>
  )
}
