'use client'

import { useIntl } from 'react-intl'
import { slugify } from '@/lib/utils/slugify'
import { copyLink } from '@/lib/utils/copyLink'
import { useFormatDate } from '../../hooks/useFormatDate'
import type { ApiComment, WorkspaceMemberInfo } from '../../types'
import { resolveCommentAuthor } from '../comment-utils'
import { CommentAvatar } from '../CommentAvatar'
import { CommentActions } from './CommentActions'
import { CommentEditMode } from './CommentEditMode'
import { ContentSignalsBadge } from '../ContentSignalsBadge'
import type { useTaskComments } from '../../hooks/useTaskComments'
import type { MentionSources } from '@/types/mention'
import { RichHtml } from '@/components/RichHtml'

interface Props {
  comment: ApiComment
  /** Workspace info needed by `resolveCommentAuthor`. */
  members: WorkspaceMemberInfo[]
  mentionSources?: MentionSources
  agentActors: { actorId: string; name: string; avatarColor: string }[]
  currentActorId: string | null | undefined
  /** For the deep-link copy: workspace slug + project name + team identifier + task #. */
  workspaceUrl: string
  projectName: string
  teamIdentifier: string
  taskNumber: number
  tc: ReturnType<typeof useTaskComments>
}

/**
 * Top-level comment row. Renders avatar + header + body (or edit-mode editor)
 * + the hover action buttons. Replies are rendered separately by the parent —
 * this component only owns the comment's own row.
 */
export function CommentItem({
  comment,
  members,
  mentionSources,
  agentActors,
  currentActorId,
  workspaceUrl,
  projectName,
  teamIdentifier,
  taskNumber,
  tc,
}: Props) {
  const intl = useIntl()
  const { fmtTimestamp } = useFormatDate()

  const ca = resolveCommentAuthor(
    comment,
    members,
    agentActors,
    intl.formatMessage({ id: 'comment.unknownAuthor' })
  )
  const isAuthor = !ca.isAgent && comment.authorActorId === currentActorId
  const isEditing = tc.editingCommentId === comment.id
  const isDeleting = tc.deletingCommentId === comment.id
  const isReplying = tc.replyingToId === comment.id
  const wasEdited =
    new Date(comment.updatedAt).getTime() -
      new Date(comment.createdAt).getTime() >
    1000

  return (
    <div
      id={`comment-${comment.id}`}
      className={`group flex gap-2.5 rounded-md transition-colors duration-slow ${tc.highlightedCommentId === comment.id ? 'bg-warning-subtle' : ''}`}
    >
      <CommentAvatar
        isAgent={ca.isAgent}
        imageUrl={ca.imageUrl}
        initials={ca.initials}
      />
      <div className='flex-1 min-w-0'>
        <div className='flex items-baseline gap-2 mb-1 flex-wrap'>
          <span className='text-xs font-semibold text-foreground'>
            {ca.name}
          </span>
          <span className='text-[11px] text-muted-foreground'>
            {fmtTimestamp(comment.createdAt)}
            {wasEdited &&
              ` · ${intl.formatMessage({ id: 'comment.edited', defaultMessage: 'edited' })}`}
          </span>
          <ContentSignalsBadge signals={comment.contentSignals} />
        </div>

        {isEditing ? (
          <CommentEditMode
            editorKey={`edit-${comment.id}`}
            initialBody={comment.body}
            draftBody={tc.editCommentBody}
            saving={tc.savingComment}
            placeholderId='task.editCommentPlaceholder'
            {...(mentionSources ? { mentionSources } : {})}
            onChange={html => tc.setEditCommentBody(html)}
            onSave={() => tc.saveEditComment(comment.id)}
            onCancel={() => tc.cancelEditing()}
          />
        ) : (
          <RichHtml
            className='prose prose-sm dark:prose-invert max-w-none text-foreground'
            html={comment.body}
          />
        )}
      </div>

      {!isEditing && (
        <div className='flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pt-0.5'>
          <CommentActions
            isAuthor={isAuthor}
            isDeleting={isDeleting}
            onCopyLink={() =>
              copyLink(
                `${window.location.origin}/workspace/${workspaceUrl}/projects/${slugify(projectName)}/tasks/${teamIdentifier}-${taskNumber}#comment-${comment.id}`
              )
            }
            onReply={() => {
              if (isReplying) tc.cancelReply()
              else tc.startReply(comment, ca.name)
            }}
            onEdit={() => tc.startEditing(comment)}
            onRequestDelete={() => tc.setConfirmDeleteId(comment.id)}
          />
        </div>
      )}
    </div>
  )
}
