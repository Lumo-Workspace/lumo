'use client'

import { useIntl } from 'react-intl'
import { Send } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { isMac } from '@/lib/utils/keyboard'
import type { MentionSources } from '@/types/mention'
import { CommentEditor } from './CommentEditor'
import { CommentQuote, previewCommentText } from './CommentQuote'
import type { useTaskComments } from '../../hooks/useTaskComments'

interface Props {
  /** The parent comment id we're replying under. */
  parentCommentId: string
  mentionSources?: MentionSources
  user: { imageUrl?: string; initials?: string } | null | undefined
  tc: ReturnType<typeof useTaskComments>
}

/**
 * Inline reply input that appears under a comment when the user clicks
 * Reply. Shows the current user's avatar, an optional quote preview of the
 * comment being replied to, the `CommentEditor`, and Cancel / Reply buttons.
 */
export function ReplyInput({
  parentCommentId,
  mentionSources,
  user,
  tc,
}: Props) {
  const intl = useIntl()

  return (
    <div className='ml-9 mt-3 flex gap-2'>
      <Avatar className='size-5 shrink-0 mt-0.5'>
        <AvatarImage src={user?.imageUrl} />
        <AvatarFallback className='text-caption'>
          {user?.initials ?? '?'}
        </AvatarFallback>
      </Avatar>
      <div className='flex-1 min-w-0 border border-border rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-ring transition-all'>
        {tc.replyingToComment && (
          <CommentQuote
            authorName={tc.replyingToComment.authorName}
            text={previewCommentText(tc.replyingToComment.body)}
            onClick={() => tc.scrollToComment(tc.replyingToComment!.id)}
            variant='in-input'
          />
        )}
        <CommentEditor
          onCommit={html => tc.setReplyBody(html)}
          onSubmit={() => tc.submitReply(parentCommentId)}
          clearRef={tc.clearReplyRef}
          {...(mentionSources ? { mentionSources } : {})}
        />
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
            onClick={() => tc.submitReply(parentCommentId)}
          >
            <Send size={12} />
            Reply
            <kbd className='ml-0.5 text-caption opacity-60 font-sans'>
              {isMac ? '⌘↵' : 'Ctrl+↵'}
            </kbd>
          </Button>
        </div>
      </div>
    </div>
  )
}
