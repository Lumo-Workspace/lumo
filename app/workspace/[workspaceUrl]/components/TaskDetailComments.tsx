'use client'

import { useIntl } from 'react-intl'
import { Send, Pencil, Trash2, Reply, Link as LinkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Spinner } from '@/components/ui/spinner'
import { isMac } from '@/lib/utils/keyboard'
import type { ApiComment, WorkspaceMemberInfo } from '../types'
import { slugify } from '@/lib/utils/slugify'
import { useFormatDate } from '../hooks/useFormatDate'
import { copyLink } from '@/lib/utils/copyLink'
import { DescriptionEditor } from './DescriptionEditorLazy'
import { CommentAvatar } from './CommentAvatar'
import { resolveCommentAuthor } from './comment-utils'
import { useMentionSources } from '../hooks/useMentionSources'
import { RichHtml } from '@/components/RichHtml'
import { previewCommentText } from './comments/CommentQuote'
import { Skeleton } from '@/components/ui/skeleton'

interface TaskDetailCommentsProps {
  workspaceUrl: string
  projectName: string
  teamIdentifier: string
  taskNumber: number
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
  mentionableMembers: WorkspaceMemberInfo[]
  currentActorId: string | null | undefined
  user: { imageUrl?: string; initials?: string } | null | undefined
  tc: {
    comments: ApiComment[]
    commentsLoading: boolean
    commentBody: string | null
    submitting: boolean
    editingCommentId: string | null
    editCommentBody: string | null
    savingComment: boolean
    deletingCommentId: string | null
    highlightedCommentId: string | null
    replyingToId: string | null
    replyingToComment: { id: string; body: string; authorName: string } | null
    replyBody: string | null
    submittingReply: boolean
    commentKey: number
    fetchComments: () => Promise<void>
    submitComment: () => void
    submitReply: (parentId: string) => void
    saveEditComment: (id: string) => void
    deleteComment: (id: string) => void
    scrollToComment: (id: string) => void
    startEditing: (comment: ApiComment) => void
    cancelEditing: () => void
    startReply: (comment: ApiComment, authorName: string) => void
    cancelReply: () => void
    setCommentBody: (body: string | null) => void
    setReplyBody: (body: string | null) => void
    setEditCommentBody: (body: string | null) => void
    setConfirmDeleteId: (id: string | null) => void
  }
}

export function TaskDetailComments({
  workspaceUrl,
  projectName,
  teamIdentifier,
  taskNumber,
  members,
  agentActors,
  mentionableMembers,
  currentActorId,
  user,
  tc,
}: TaskDetailCommentsProps) {
  const intl = useIntl()
  const unknownAuthor = intl.formatMessage({ id: 'comment.unknownAuthor' })
  const { fmtTimestamp } = useFormatDate()
  const mentionSources = useMentionSources(mentionableMembers)

  return (
    <>
      {/* Skeleton while loading */}
      {tc.commentsLoading && tc.comments.length === 0 ? (
        <div className='space-y-3'>
          {[1, 2].map(i => (
            <div key={i} className='flex gap-2.5'>
              <Skeleton className='size-7 shrink-0 rounded-full' />
              <div className='flex-1 space-y-1.5 pt-0.5'>
                <Skeleton className='h-2.5 w-1/3 rounded-sm' />
                <Skeleton className='h-2.5 w-2/3 rounded-sm' />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className='space-y-5'>
          {tc.comments.map(comment => {
            const ca = resolveCommentAuthor(
              comment,
              members,
              agentActors,
              unknownAuthor
            )
            const isAuthor =
              !ca.isAgent && comment.authorActorId === currentActorId
            const isEditing = tc.editingCommentId === comment.id
            const isDeleting = tc.deletingCommentId === comment.id
            const wasEdited =
              new Date(comment.updatedAt).getTime() -
                new Date(comment.createdAt).getTime() >
              1000
            const isReplying = tc.replyingToId === comment.id

            return (
              <div key={comment.id}>
                {/* ── Top-level comment ── */}
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
                      <span className='text-caption font-semibold text-foreground'>
                        {ca.name}
                      </span>
                      <span className='text-caption text-muted-foreground'>
                        {fmtTimestamp(comment.createdAt)}
                        {wasEdited &&
                          ` · ${intl.formatMessage({ id: 'task.edited' })}`}
                      </span>
                    </div>

                    {isEditing ? (
                      <div className='border border-border rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-ring transition-all'>
                        <div
                          className='px-3 pt-2 pb-1 text-body'
                          onKeyDown={e => {
                            if (
                              (isMac ? e.metaKey : e.ctrlKey) &&
                              e.key === 'Enter'
                            ) {
                              e.preventDefault()
                              tc.saveEditComment(comment.id)
                            }
                            if (e.key === 'Escape') {
                              tc.cancelEditing()
                            }
                          }}
                        >
                          <DescriptionEditor
                            key={`edit-${comment.id}`}
                            value={comment.body}
                            onCommit={html => tc.setEditCommentBody(html)}
                            onChange={html => tc.setEditCommentBody(html)}
                            placeholder={intl.formatMessage({
                              id: 'task.editCommentPlaceholder',
                            })}
                            mentionSources={mentionSources}
                          />
                        </div>
                        <div className='flex justify-end gap-2 px-2 pb-2'>
                          <Button
                            size='sm'
                            variant='ghost'
                            className='h-7 text-caption'
                            onClick={() => tc.cancelEditing()}
                          >
                            {intl.formatMessage({ id: 'common.cancel' })}
                          </Button>
                          <Button
                            size='sm'
                            className='h-7 text-caption'
                            disabled={
                              !tc.editCommentBody?.trim() || tc.savingComment
                            }
                            onClick={() => tc.saveEditComment(comment.id)}
                          >
                            {intl.formatMessage({ id: 'common.save' })}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <RichHtml
                        className='prose prose-sm dark:prose-invert max-w-none text-foreground'
                        html={comment.body}
                      />
                    )}
                  </div>

                  {/* Actions — visible on hover */}
                  {!isEditing && (
                    <div className='flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pt-0.5'>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className='size-6 flex items-center justify-center rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
                            onClick={() =>
                              copyLink(
                                `${window.location.origin}/workspace/${workspaceUrl}/projects/${slugify(projectName)}/tasks/${teamIdentifier}-${taskNumber}#comment-${comment.id}`
                              )
                            }
                          >
                            <LinkIcon size={12} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {intl.formatMessage({ id: 'task.copyCommentLink' })}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className='size-6 flex items-center justify-center rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
                            onClick={() => {
                              if (isReplying) {
                                tc.cancelReply()
                              } else {
                                tc.startReply(comment, ca.name)
                              }
                            }}
                          >
                            <Reply size={12} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {intl.formatMessage({ id: 'task.reply' })}
                        </TooltipContent>
                      </Tooltip>
                      {isAuthor && (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                className='size-6 flex items-center justify-center rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
                                onClick={() => tc.startEditing(comment)}
                              >
                                <Pencil size={12} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {intl.formatMessage({ id: 'common.edit' })}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                className='size-6 flex items-center justify-center rounded-sm hover:bg-muted text-muted-foreground hover:text-danger-text transition-colors disabled:opacity-40'
                                disabled={isDeleting}
                                onClick={() =>
                                  tc.setConfirmDeleteId(comment.id)
                                }
                              >
                                {isDeleting ? (
                                  <Spinner className='size-3 text-muted-foreground' />
                                ) : (
                                  <Trash2 size={12} />
                                )}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {intl.formatMessage({ id: 'common.delete' })}
                            </TooltipContent>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Replies ── */}
                {(comment.replies?.length ?? 0) > 0 && (
                  <div className='ml-9 mt-3 space-y-3 border-l-2 border-border pl-3'>
                    {comment.replies!.map(reply => {
                      const ra = resolveCommentAuthor(
                        reply,
                        members,
                        agentActors,
                        unknownAuthor
                      )
                      const rIsAuthor =
                        !ra.isAgent && reply.authorActorId === currentActorId
                      const rIsEditing = tc.editingCommentId === reply.id
                      const rIsDeleting = tc.deletingCommentId === reply.id
                      const rWasEdited =
                        new Date(reply.updatedAt).getTime() -
                          new Date(reply.createdAt).getTime() >
                        1000
                      return (
                        <div
                          key={reply.id}
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
                                  ` · ${intl.formatMessage({ id: 'task.edited' })}`}
                              </span>
                            </div>
                            {rIsEditing ? (
                              <div className='border border-border rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-ring transition-all'>
                                <div
                                  className='px-3 pt-2 pb-1 text-body'
                                  onKeyDown={e => {
                                    if (
                                      (isMac ? e.metaKey : e.ctrlKey) &&
                                      e.key === 'Enter'
                                    ) {
                                      e.preventDefault()
                                      tc.saveEditComment(reply.id)
                                    }
                                    if (e.key === 'Escape') {
                                      tc.cancelEditing()
                                    }
                                  }}
                                >
                                  <DescriptionEditor
                                    key={`edit-reply-${reply.id}`}
                                    value={reply.body}
                                    onCommit={html =>
                                      tc.setEditCommentBody(html)
                                    }
                                    onChange={html =>
                                      tc.setEditCommentBody(html)
                                    }
                                    placeholder={intl.formatMessage({
                                      id: 'task.editReplyPlaceholder',
                                    })}
                                    mentionSources={mentionSources}
                                  />
                                </div>
                                <div className='flex justify-end gap-2 px-2 pb-2'>
                                  <Button
                                    size='sm'
                                    variant='ghost'
                                    className='h-7 text-caption'
                                    onClick={() => tc.cancelEditing()}
                                  >
                                    {intl.formatMessage({
                                      id: 'common.cancel',
                                    })}
                                  </Button>
                                  <Button
                                    size='sm'
                                    className='h-7 text-caption'
                                    disabled={
                                      !tc.editCommentBody?.trim() ||
                                      tc.savingComment
                                    }
                                    onClick={() => tc.saveEditComment(reply.id)}
                                  >
                                    {intl.formatMessage({ id: 'common.save' })}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {reply.quotedCommentId &&
                                  (() => {
                                    const allComments = [
                                      comment,
                                      ...(comment.replies ?? []),
                                    ]
                                    const quoted = allComments.find(
                                      c => c.id === reply.quotedCommentId
                                    )
                                    if (!quoted) return null
                                    const qName = resolveCommentAuthor(
                                      quoted,
                                      members,
                                      agentActors,
                                      unknownAuthor
                                    ).name
                                    const qText = previewCommentText(
                                      quoted.body
                                    )
                                    return (
                                      <button
                                        type='button'
                                        onClick={() =>
                                          tc.scrollToComment(
                                            reply.quotedCommentId!
                                          )
                                        }
                                        className='mb-1.5 w-full text-left border-l-2 border-border pl-2.5 py-0.5 hover:border-muted-foreground hover:bg-muted rounded-r transition-colors'
                                      >
                                        <p className='text-caption font-semibold text-muted-foreground mb-0.5'>
                                          {qName}
                                        </p>
                                        <p className='text-caption text-muted-foreground line-clamp-2'>
                                          {qText}
                                        </p>
                                      </button>
                                    )
                                  })()}
                                <RichHtml
                                  className='prose prose-sm dark:prose-invert max-w-none text-foreground'
                                  html={reply.body}
                                />
                              </>
                            )}
                          </div>
                          {!rIsEditing && (
                            <div className='flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pt-0.5'>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    className='size-6 flex items-center justify-center rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
                                    onClick={() =>
                                      copyLink(
                                        `${window.location.origin}/workspace/${workspaceUrl}/projects/${slugify(projectName)}/tasks/${teamIdentifier}-${taskNumber}#comment-${reply.id}`
                                      )
                                    }
                                  >
                                    <LinkIcon size={12} />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {intl.formatMessage({
                                    id: 'task.copyCommentLink',
                                  })}
                                </TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    className='size-6 flex items-center justify-center rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
                                    onClick={() => {
                                      if (tc.replyingToId === comment.id) {
                                        tc.cancelReply()
                                      } else {
                                        tc.startReply(reply, ra.name)
                                      }
                                    }}
                                  >
                                    <Reply size={12} />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {intl.formatMessage({ id: 'task.reply' })}
                                </TooltipContent>
                              </Tooltip>
                              {rIsAuthor && (
                                <>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        className='size-6 flex items-center justify-center rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
                                        onClick={() => tc.startEditing(reply)}
                                      >
                                        <Pencil size={12} />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {intl.formatMessage({
                                        id: 'common.edit',
                                      })}
                                    </TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        className='size-6 flex items-center justify-center rounded-sm hover:bg-muted text-muted-foreground hover:text-danger-text transition-colors disabled:opacity-40'
                                        disabled={rIsDeleting}
                                        onClick={() =>
                                          tc.setConfirmDeleteId(reply.id)
                                        }
                                      >
                                        {rIsDeleting ? (
                                          <Spinner className='size-3 text-muted-foreground' />
                                        ) : (
                                          <Trash2 size={12} />
                                        )}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {intl.formatMessage({
                                        id: 'common.delete',
                                      })}
                                    </TooltipContent>
                                  </Tooltip>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* ── Inline reply input ── */}
                {isReplying && (
                  <div className='ml-9 mt-3 flex gap-2'>
                    <Avatar className='size-5 shrink-0 mt-0.5'>
                      <AvatarImage src={user?.imageUrl} />
                      <AvatarFallback className='text-caption'>
                        {user?.initials ?? '?'}
                      </AvatarFallback>
                    </Avatar>
                    <div className='flex-1 min-w-0 border border-border rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-ring transition-all'>
                      {tc.replyingToComment && (
                        <button
                          type='button'
                          onClick={() =>
                            tc.scrollToComment(tc.replyingToComment!.id)
                          }
                          className='mx-3 mt-2.5 mb-1 w-[calc(100%-1.5rem)] text-left border-l-2 border-border pl-2.5 py-0.5 hover:border-muted-foreground hover:bg-muted rounded-r transition-colors'
                        >
                          <p className='text-caption font-semibold text-muted-foreground mb-0.5'>
                            {tc.replyingToComment.authorName}
                          </p>
                          <p className='text-caption text-muted-foreground line-clamp-2'>
                            {previewCommentText(tc.replyingToComment.body)}
                          </p>
                        </button>
                      )}
                      <div
                        className='px-3 pt-2 pb-1 text-body'
                        onKeyDown={e => {
                          if (
                            (isMac ? e.metaKey : e.ctrlKey) &&
                            e.key === 'Enter'
                          ) {
                            e.preventDefault()
                            tc.submitReply(comment.id)
                          }
                        }}
                      >
                        <DescriptionEditor
                          key={`reply-${comment.id}`}
                          value={null}
                          onCommit={html => tc.setReplyBody(html)}
                          onChange={html => tc.setReplyBody(html)}
                          placeholder={intl.formatMessage({
                            id: 'task.replyPlaceholder',
                          })}
                          mentionSources={mentionSources}
                        />
                      </div>
                      <div className='flex items-center justify-between px-2 pb-2'>
                        <button
                          className='text-caption text-muted-foreground hover:text-foreground transition-colors'
                          onClick={() => tc.cancelReply()}
                        >
                          {intl.formatMessage({ id: 'common.cancel' })}
                        </button>
                        <Button
                          size='sm'
                          className='h-7 text-caption gap-1.5'
                          disabled={!tc.replyBody?.trim() || tc.submittingReply}
                          onClick={() => tc.submitReply(comment.id)}
                        >
                          <Send size={12} />
                          {intl.formatMessage({ id: 'task.reply' })}
                          <Kbd variant='solid' className='ml-0.5'>
                            {isMac ? '⌘↵' : 'Ctrl+↵'}
                          </Kbd>
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* New comment input */}
      <div className='mt-5 flex gap-2.5'>
        <Avatar className='size-7 shrink-0 mt-0.5'>
          <AvatarImage src={user?.imageUrl} />
          <AvatarFallback className='text-caption'>
            {user?.initials ?? '?'}
          </AvatarFallback>
        </Avatar>
        <div className='flex-1 min-w-0 border border-border rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-ring transition-all'>
          <div
            className='px-3 pt-2 pb-1 text-body'
            onKeyDown={e => {
              if ((isMac ? e.metaKey : e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                tc.submitComment()
              }
            }}
          >
            <DescriptionEditor
              key={tc.commentKey}
              value={null}
              onCommit={tc.setCommentBody}
              onChange={tc.setCommentBody}
              placeholder={intl.formatMessage({
                id: 'task.commentPlaceholder',
              })}
              mentionSources={mentionSources}
            />
          </div>
          <div className='flex justify-end px-2 pb-2'>
            <Button
              size='sm'
              className='h-7 text-caption gap-1.5'
              disabled={!tc.commentBody?.trim() || tc.submitting}
              onClick={tc.submitComment}
            >
              <Send size={12} />
              {intl.formatMessage({ id: 'task.comment' })}
              <Kbd variant='solid' className='ml-0.5'>
                {isMac ? '⌘↵' : 'Ctrl+↵'}
              </Kbd>
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
