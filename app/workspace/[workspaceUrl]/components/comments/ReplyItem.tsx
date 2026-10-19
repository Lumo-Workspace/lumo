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
import { CommentQuote, previewCommentText } from './CommentQuote'
import type { useTaskComments } from '../../hooks/useTaskComments'
import type { MentionSources } from '@/types/mention'
import { RichHtml } from '@/components/RichHtml'

interface Props {
  reply: ApiComment
  /** The reply's parent comment — needed both to scope the action callbacks
   * (Reply button cancels by parent id) and to resolve quotedCommentId from
   * the parent's loaded reply tree. */
  parent: ApiComment
  members: WorkspaceMemberInfo[]
  mentionSources?: MentionSources
  agentActors: { actorId: string; name: string; avatarColor: string }[]
  currentActorId: string | null | undefined
  workspaceUrl: string
  projectName: string
  teamIdentifier: string
  taskNumber: number
  tc: ReturnType<typeof useTaskComments>
}

/**
 * Nested reply row. Same shape as `CommentItem` but indented under its parent
 * by the caller, smaller avatar, and renders a `CommentQuote` when the reply
 * `quotedCommentId` points at a sibling reply in the parent's thread.
 */
export function ReplyItem({
  reply,
  parent,
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

  const unknownAuthor = intl.formatMessage({ id: 'comment.unknownAuthor' })
  const ra = resolveCommentAuthor(reply, members, agentActors, unknownAuthor)
  const rIsAuthor = !ra.isAgent && reply.authorActorId === currentActorId
  const rIsEditing = tc.editingCommentId === reply.id
  const rIsDeleting = tc.deletingCommentId === reply.id
  const rWasEdited =
    new Date(reply.updatedAt).getTime() - new Date(reply.createdAt).getTime() >
    1000

  // Resolve the quoted comment (if any) from the parent's loaded tree.
  const quoted = reply.quotedCommentId
    ? [parent, ...(parent.replies ?? [])].find(
        c => c.id === reply.quotedCommentId
      )
    : null
  const quotedAuthorName = quoted
    ? resolveCommentAuthor(quoted, members, agentActors, unknownAuthor).name
    : null

  return (
    <div
      id={`comment-${reply.id}`}
      className={`group flex gap-2 rounded-md transition-colors duration-slow ${tc.highlightedCommentId === reply.id ? 'bg-warning-subtle' : ''}`}
    >
      <CommentAvatar
        isAgent={ra.isAgent}
        imageUrl={ra.imageUrl}
        initials={ra.initials}
        size='sm'
      />
      <div className='flex-1 min-w-0'>
        <div className='flex items-baseline gap-1.5 mb-0.5 flex-wrap'>
          <span className='text-caption font-semibold text-foreground'>
            {ra.name}
          </span>
          <span className='text-caption text-muted-foreground'>
            {fmtTimestamp(reply.createdAt)}
            {rWasEdited &&
              ` · ${intl.formatMessage({ id: 'comment.edited', defaultMessage: 'edited' })}`}
          </span>
          <ContentSignalsBadge signals={reply.contentSignals} />
        </div>
        {rIsEditing ? (
          <CommentEditMode
            editorKey={`edit-reply-${reply.id}`}
            initialBody={reply.body}
            draftBody={tc.editCommentBody}
            saving={tc.savingComment}
            placeholderId='task.editReplyPlaceholder'
            {...(mentionSources ? { mentionSources } : {})}
            onChange={html => tc.setEditCommentBody(html)}
            onSave={() => tc.saveEditComment(reply.id)}
            onCancel={() => tc.cancelEditing()}
          />
        ) : (
          <>
            {quoted && (
              <CommentQuote
                authorName={quotedAuthorName ?? unknownAuthor}
                text={previewCommentText(quoted.body)}
                onClick={() => tc.scrollToComment(reply.quotedCommentId!)}
                variant='in-reply'
              />
            )}
            <RichHtml
              className='prose prose-sm dark:prose-invert max-w-none text-foreground'
              html={reply.body}
            />
          </>
        )}
      </div>
      {!rIsEditing && (
        <div className='flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pt-0.5'>
          <CommentActions
            isAuthor={rIsAuthor}
            isDeleting={rIsDeleting}
            onCopyLink={() =>
              copyLink(
                `${window.location.origin}/workspace/${workspaceUrl}/projects/${slugify(projectName)}/tasks/${teamIdentifier}-${taskNumber}#comment-${reply.id}`
              )
            }
            onReply={() => {
              // Replying to a reply collapses back to the parent thread —
              // the comment service only supports one level of nesting.
              if (tc.replyingToId === parent.id) tc.cancelReply()
              else tc.startReply(reply, ra.name)
            }}
            onEdit={() => tc.startEditing(reply)}
            onRequestDelete={() => tc.setConfirmDeleteId(reply.id)}
          />
        </div>
      )}
    </div>
  )
}
