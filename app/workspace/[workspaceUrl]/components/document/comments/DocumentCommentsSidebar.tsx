'use client'
import { useIntl } from 'react-intl'
import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'
import { CommentAvatar } from '@/app/workspace/[workspaceUrl]/components/CommentAvatar'
import {
  resolveCommentAuthor,
  type AgentActorInfo,
} from '@/app/workspace/[workspaceUrl]/components/comment-utils'
import type { WorkspaceMemberInfo } from '@/app/workspace/[workspaceUrl]/types'

export interface DocumentCommentsSidebarProps {
  comments: ApiDocumentComment[]
  members: WorkspaceMemberInfo[]
  agentActors: AgentActorInfo[]
  currentActorId: string | null | undefined
  onSelectThread?: (commentId: string) => void
}

export function DocumentCommentsSidebar(props: DocumentCommentsSidebarProps) {
  const intl = useIntl()
  if (props.comments.length === 0) {
    return (
      <div className='p-3 text-sm text-muted-foreground'>
        {intl.formatMessage({ id: 'document.noComments' })}
      </div>
    )
  }
  return (
    <div className='flex flex-col gap-2 p-2'>
      {props.comments.map(c => {
        const author = resolveCommentAuthor(c, props.members, props.agentActors)
        return (
          <button
            key={c.id}
            type='button'
            onClick={() => props.onSelectThread?.(c.id)}
            className='rounded-md border p-2 text-left hover:bg-muted'
          >
            {c.quotedText && (
              <div className='mb-1 line-clamp-2 border-l-2 border-primary/50 pl-2 text-xs text-muted-foreground'>
                {c.quotedText}
              </div>
            )}
            <div className='flex items-center gap-2'>
              <CommentAvatar
                isAgent={author.isAgent}
                imageUrl={author.imageUrl}
                initials={author.initials}
                size='sm'
              />
              <div
                className='prose-sm text-sm'
                dangerouslySetInnerHTML={{ __html: c.body }}
              />
            </div>
            {(c.replies?.length ?? 0) > 0 && (
              <div className='mt-1 text-xs text-muted-foreground'>
                {c.replies!.length}{' '}
                {intl.formatMessage({ id: 'document.replies' })}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}
