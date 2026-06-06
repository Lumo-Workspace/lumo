'use client'

import type { TimelineCommentEntry, WorkspaceMemberInfo } from '../../../types'
import { CommentAvatar } from '../../CommentAvatar'
import { resolveCommentAuthor } from '../../comment-utils'
import { useFormatDate } from '../../../hooks/useFormatDate'

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
  const { fmtTimestamp } = useFormatDate()
  const ca = resolveCommentAuthor(entry as any, members, agentActors)

  return (
    <div className='flex gap-2.5 py-2'>
      <CommentAvatar
        isAgent={ca.isAgent}
        imageUrl={ca.imageUrl}
        initials={ca.initials}
      />
      <div className='flex-1 min-w-0'>
        <div className='flex items-baseline gap-2 mb-1'>
          <span className='text-caption font-semibold text-zinc-800 dark:text-zinc-200'>
            {ca.name}
          </span>
          <span className='text-[11px] text-zinc-400 dark:text-zinc-500'>
            {fmtTimestamp(entry.createdAt)}
          </span>
        </div>
        <div
          className='prose prose-sm dark:prose-invert max-w-none text-zinc-700 dark:text-zinc-300'
          dangerouslySetInnerHTML={{ __html: entry.body }}
        />
      </div>
    </div>
  )
}
