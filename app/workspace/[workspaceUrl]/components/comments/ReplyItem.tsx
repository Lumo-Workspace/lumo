'use client'

import { useIntl } from 'react-intl'
import { slugify } from '@/lib/utils/slugify'
import { copyLink } from '@/lib/utils/copyLink'
import { useFormatDate } from '../../hooks/useFormatDate'
import type { ApiComment, ApiTask, WorkspaceMemberInfo } from '../../types'
import { resolveCommentAuthor } from '../comment-utils'
import { CommentAvatar } from '../CommentAvatar'
import { CommentActions } from './CommentActions'
import { CommentEditMode } from './CommentEditMode'
import { CommentQuote, previewCommentText } from './CommentQuote'
import type { useTaskComments } from '../../hooks/useTaskComments'

interface Props {
  reply: ApiComment
  /** The reply's parent comment — needed both to scope the action callbacks
   * (Reply button cancels by parent id) and to resolve quotedCommentId from
   * the parent's loaded reply tree. */
  parent: ApiComment
  members: WorkspaceMemberInfo[]
  mentionableMembers: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
  currentActorId: string | null | undefined
  tasks?: ApiTask[] | undefined
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
  mentionableMembers,
  agentActors,
  currentActorId,
  tasks,
  workspaceUrl,
  projectName,
  teamIdentifier,
  taskNumber,
  tc,
}: Props) {
  const intl = useIntl()
  const { fmtTimestamp } = useFormatDate()

  const ra = resolveCommentAuthor(reply, members, agentActors)
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
  const quotedAuthor = quoted
    ? members.find(m => m.actorId === quoted.authorActorId)
    : null

  return (
    <div
      id={`comment-${reply.id}`}
      className={`group flex gap-2 rounded-md transition-colors duration-300 ${tc.highlightedCommentId === reply.id ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}
    >
      <CommentAvatar
        isAgent={ra.isAgent}
        imageUrl={ra.imageUrl}
        initials={ra.initials}
        size='sm'
      />
      <div className='flex-1 min-w-0'>
        <div className='flex items-baseline gap-1.5 mb-0.5 flex-wrap'>
          <span className='text-xs font-semibold text-zinc-800 dark:text-zinc-200'>
            {ra.name}
          </span>
          <span className='text-[11px] text-zinc-400 dark:text-zinc-500'>
            {fmtTimestamp(reply.createdAt)}
            {rWasEdited &&
              ` · ${intl.formatMessage({ id: 'comment.edited', defaultMessage: 'edited' })}`}
          </span>
        </div>
        {rIsEditing ? (
          <CommentEditMode
            editorKey={`edit-reply-${reply.id}`}
            initialBody={reply.body}
            draftBody={tc.editCommentBody}
            saving={tc.savingComment}
            placeholderId='task.editReplyPlaceholder'
            mentionableMembers={mentionableMembers}
            tasks={tasks}
            agentActors={agentActors}
            onChange={html => tc.setEditCommentBody(html)}
            onSave={() => tc.saveEditComment(reply.id)}
            onCancel={() => tc.cancelEditing()}
          />
        ) : (
          <>
            {quoted && (
              <CommentQuote
                authorName={quotedAuthor?.name ?? 'Unknown'}
                text={previewCommentText(quoted.body)}
                onClick={() => tc.scrollToComment(reply.quotedCommentId!)}
                variant='in-reply'
              />
            )}
            <div
              className='prose prose-sm dark:prose-invert max-w-none text-zinc-700 dark:text-zinc-300'
              dangerouslySetInnerHTML={{ __html: reply.body }}
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
                `${window.location.origin}/workspace/${workspaceUrl}/project/${slugify(projectName)}/tasks/${teamIdentifier}-${taskNumber}#comment-${reply.id}`
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
