'use client'

import { useIntl } from 'react-intl'
import { Send } from 'lucide-react'
import { MemberAvatar } from '@/components/MemberAvatar'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { isMac } from '@/lib/utils/keyboard'
import type { WorkspaceMemberInfo } from '../types'
import { CommentEditor } from './comments/CommentEditor'
import { CommentItem } from './comments/CommentItem'
import { ReplyItem } from './comments/ReplyItem'
import { ReplyInput } from './comments/ReplyInput'
import { useMentionSources } from '../hooks/useMentionSources'

export interface CommentSectionProps {
  workspaceUrl: string
  projectName: string
  teamIdentifier: string
  taskNumber: number
  members: WorkspaceMemberInfo[]
  mentionableMembers: WorkspaceMemberInfo[]
  agentActors?:
    | { actorId: string; name: string; avatarColor: string }[]
    | undefined
  currentActorId: string | null | undefined
  user: { imageUrl?: string; displayName?: string } | null | undefined
  tc: ReturnType<typeof import('../hooks/useTaskComments').useTaskComments>
}

export function CommentSection({
  workspaceUrl,
  projectName,
  teamIdentifier,
  taskNumber,
  members,
  mentionableMembers,
  agentActors,
  currentActorId,
  user,
  tc,
}: CommentSectionProps) {
  const intl = useIntl()
  const resolvedAgentActors = agentActors ?? []
  const mentionSources = useMentionSources(mentionableMembers)

  return (
    <>
      <div className='mt-8 pt-6'>
        <p className='text-caption font-semibold text-muted-foreground uppercase mb-4'>
          {intl.formatMessage({
            id: 'task.comments',
            defaultMessage: 'Comments',
          })}
        </p>

        {tc.commentsLoading && tc.comments.length === 0 ? (
          <div className='space-y-3'>
            {[1, 2].map(i => (
              <div key={i} className='flex gap-2.5'>
                <div className='size-7 rounded-full bg-muted animate-pulse shrink-0' />
                <div className='flex-1 space-y-1.5 pt-0.5'>
                  <div className='h-2.5 bg-muted rounded-sm animate-pulse w-1/3' />
                  <div className='h-2.5 bg-muted rounded-sm animate-pulse w-2/3' />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className='space-y-5'>
            {tc.comments.map(comment => (
              <div key={comment.id}>
                <CommentItem
                  comment={comment}
                  members={members}
                  mentionSources={mentionSources}
                  agentActors={resolvedAgentActors}
                  currentActorId={currentActorId}
                  workspaceUrl={workspaceUrl}
                  projectName={projectName}
                  teamIdentifier={teamIdentifier}
                  taskNumber={taskNumber}
                  tc={tc}
                />

                {(comment.replies?.length ?? 0) > 0 && (
                  <div className='ml-9 mt-3 space-y-3 border-l-2 border-border pl-3'>
                    {comment.replies!.map(reply => (
                      <ReplyItem
                        key={reply.id}
                        reply={reply}
                        parent={comment}
                        members={members}
                        mentionSources={mentionSources}
                        agentActors={resolvedAgentActors}
                        currentActorId={currentActorId}
                        workspaceUrl={workspaceUrl}
                        projectName={projectName}
                        teamIdentifier={teamIdentifier}
                        taskNumber={taskNumber}
                        tc={tc}
                      />
                    ))}
                  </div>
                )}

                {tc.replyingToId === comment.id && (
                  <ReplyInput
                    parentCommentId={comment.id}
                    mentionSources={mentionSources}
                    user={user}
                    tc={tc}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* New comment input */}
        <div className='mt-5 flex gap-2.5'>
          <MemberAvatar
            name={user?.displayName ?? ''}
            imageUrl={user?.imageUrl}
            size='md'
            className='mt-0.5'
          />
          <div className='flex-1 min-w-0 border border-border rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-ring transition-all'>
            <CommentEditor
              onCommit={html => tc.setCommentBody(html)}
              onSubmit={tc.submitComment}
              clearRef={tc.clearCommentRef}
              mentionSources={mentionSources}
            />
            <div className='flex justify-end px-2 pb-2'>
              <Button
                size='sm'
                className='h-7 text-caption gap-1.5'
                disabled={!tc.commentBody?.trim() || tc.submitting}
                onClick={tc.submitComment}
              >
                <Send size={12} />
                {intl.formatMessage({
                  id: 'task.commentSubmit',
                  defaultMessage: 'Comment',
                })}
                <kbd className='ml-0.5 text-caption opacity-60 font-sans'>
                  {isMac ? '⌘↵' : 'Ctrl+↵'}
                </kbd>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Delete-comment confirmation dialog */}
      <AlertDialog
        open={tc.confirmDeleteId !== null}
        onOpenChange={open => {
          if (!open) tc.setConfirmDeleteId(null)
        }}
      >
        <AlertDialogContent
          className='max-w-xs'
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (tc.confirmDeleteId) tc.deleteComment(tc.confirmDeleteId)
              tc.setConfirmDeleteId(null)
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: 'task.deleteCommentTitle' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'task.deleteCommentDesc' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {intl.formatMessage({ id: 'common.cancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                if (tc.confirmDeleteId) tc.deleteComment(tc.confirmDeleteId)
                tc.setConfirmDeleteId(null)
              }}
            >
              {intl.formatMessage({ id: 'common.delete' })}
              <kbd className='ml-1.5 text-caption opacity-60 font-sans'>↵</kbd>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
