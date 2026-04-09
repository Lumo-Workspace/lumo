'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  CheckCheck,
  RotateCcw,
  Loader2,
  SendHorizonal,
  ThumbsUp,
  ShieldCheck,
  ShieldX,
} from 'lucide-react'
import { ApiNotification, ApiStatus } from '../types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Item, ItemMedia, ItemContent, ItemActions } from '@/components/ui/item'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { getInitials } from '@/lib/utils/getInitials'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Render comment body with @[clerkId] replaced by highlighted @mention spans */
function CommentPreview({ body }: { body: string }) {
  const parts = body.split(/(@\[[^\]]+\])/)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('@[') && part.endsWith(']')) {
          return (
            <mark
              key={i}
              className='bg-transparent text-blue-500 dark:text-blue-400 font-medium not-italic'
            >
              {`@${part.slice(2, -1)}`}
            </mark>
          )
        }
        return part
      })}
    </>
  )
}

/** Returns true if the notification requires a pending user action. */
export function isPendingAction(n: ApiNotification): boolean {
  return n.requiresAction && n.actionTakenAt === null
}

// ─── Actionable widgets ───────────────────────────────────────────────────────

function AgentClarifyWidget({
  notification,
  onRespond,
}: {
  notification: ApiNotification
  onRespond: (id: string, action: 'reply', reply: string) => void
}) {
  const [reply, setReply] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    const trimmed = reply.trim()
    if (!trimmed) return
    setSubmitting(true)
    onRespond(notification.id, 'reply', trimmed)
  }

  return (
    <div className='mt-2 space-y-1.5' onClick={e => e.stopPropagation()}>
      {notification.clarifyQuestion && (
        <p className='text-xs text-foreground/80 italic leading-snug'>
          {notification.clarifyQuestion}
        </p>
      )}
      {notification.clarifyContext && (
        <p className='text-xs text-muted-foreground leading-snug'>
          {notification.clarifyContext}
        </p>
      )}
      <Textarea
        value={reply}
        onChange={e => setReply(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            handleSubmit()
          }
        }}
        placeholder='Reply to the agent...'
        className='text-xs min-h-[56px] resize-none'
        disabled={submitting}
        autoFocus={false}
      />
      <Button
        size='sm'
        className='h-6 text-[11px] px-2'
        disabled={!reply.trim() || submitting}
        onClick={handleSubmit}
      >
        {submitting ? (
          <Loader2
            size={11}
            className='animate-spin'
            data-icon='inline-start'
          />
        ) : (
          <SendHorizonal size={11} data-icon='inline-start' />
        )}
        Send reply
      </Button>
    </div>
  )
}

function AgentVerifyWidget({
  notification,
  onRespond,
}: {
  notification: ApiNotification
  onRespond: (id: string, action: 'confirm' | 'send_back') => void
}) {
  const [actionTaken, setActionTaken] = useState<
    'confirm' | 'send_back' | null
  >(null)

  return (
    <ItemActions className='mt-0.5' onClick={e => e.stopPropagation()}>
      <Button
        size='sm'
        className={cn(
          'h-6 text-[11px] px-2',
          actionTaken === 'send_back' && 'opacity-40'
        )}
        disabled={!!actionTaken}
        onClick={() => {
          setActionTaken('confirm')
          onRespond(notification.id, 'confirm')
        }}
      >
        <ThumbsUp size={11} data-icon='inline-start' />
        Confirm
      </Button>
      <Button
        size='sm'
        variant='outline'
        className={cn(
          'h-6 text-[11px] px-2',
          actionTaken === 'confirm' && 'opacity-40'
        )}
        disabled={!!actionTaken}
        onClick={() => {
          setActionTaken('send_back')
          onRespond(notification.id, 'send_back')
        }}
      >
        <RotateCcw size={11} data-icon='inline-start' />
        Send back
      </Button>
    </ItemActions>
  )
}

function AgentAuthorizeWidget({
  notification,
  onRespond,
}: {
  notification: ApiNotification
  onRespond: (id: string, action: 'approve' | 'deny') => void
}) {
  const [actionTaken, setActionTaken] = useState<'approve' | 'deny' | null>(
    null
  )

  return (
    <ItemActions className='mt-0.5' onClick={e => e.stopPropagation()}>
      <Button
        size='sm'
        className={cn(
          'h-6 text-[11px] px-2',
          actionTaken === 'deny' && 'opacity-40'
        )}
        disabled={!!actionTaken}
        onClick={() => {
          setActionTaken('approve')
          onRespond(notification.id, 'approve')
        }}
      >
        <ShieldCheck size={11} data-icon='inline-start' />
        Approve
      </Button>
      <Button
        size='sm'
        variant='outline'
        className={cn(
          'h-6 text-[11px] px-2 text-destructive hover:text-destructive',
          actionTaken === 'approve' && 'opacity-40'
        )}
        disabled={!!actionTaken}
        onClick={() => {
          setActionTaken('deny')
          onRespond(notification.id, 'deny')
        }}
      >
        <ShieldX size={11} data-icon='inline-start' />
        Deny
      </Button>
    </ItemActions>
  )
}

// ─── Notification item ────────────────────────────────────────────────────────

export function NotificationItem({
  notification,
  isSelected,
  onSelect,
  onMarkRead,
  onMarkUnread,
  onDelete,
  onTaskAction,
  onRespond,
}: {
  notification: ApiNotification
  isSelected: boolean
  onSelect: () => void
  onMarkRead: () => void
  onMarkUnread: () => void
  onDelete: () => void
  onTaskAction: (status: ApiStatus) => void
  onRespond: (
    id: string,
    action: 'reply' | 'confirm' | 'send_back' | 'approve' | 'deny',
    reply?: string
  ) => void
}) {
  const { actor, task, type, commentPreview, createdAt, read } = notification

  // Track which review action was taken this session so buttons stay visible
  // after clicking instead of disappearing when read flips to true.
  // wasUnreadOnMount captures whether to show buttons at all (we don't show
  // action buttons for notifications that were already read on page load).
  const [wasUnreadOnMount] = useState(!read)
  const [taskActionTaken, setTaskActionTaken] = useState<
    'DONE' | 'IN_PROGRESS' | null
  >(null)

  const pendingAction = isPendingAction(notification)

  const VERB: Partial<Record<ApiNotification['type'], string>> = {
    TASK_IN_REVIEW: 'submitted for review',
    TASK_SENT_BACK: 'sent back to In Progress',
    TASK_ASSIGNED: 'assigned you to',
    TASK_SPEC_READY: 'generated a spec draft for',
    TASK_MENTIONED: 'mentioned you in',
    AGENT_CLARIFY: 'has a question about',
    AGENT_AUTHORIZE: 'needs your approval for',
    AGENT_VERIFY: 'completed work on',
    AGENT_FAILED: 'failed on',
    AGENT_DONE: 'finished work on',
  }
  const verb = VERB[type] ?? 'mentioned you in'

  const timeAgo = formatDistanceToNow(new Date(createdAt), { addSuffix: true })

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Item
          size='sm'
          variant='default'
          className={cn(
            'relative cursor-pointer rounded-md hover:bg-accent/50',
            isSelected && 'bg-accent',
            read && !pendingAction && 'opacity-60',
            pendingAction &&
              'border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20'
          )}
          onClick={e => {
            e.stopPropagation()
            onSelect()
            if (!read) onMarkRead()
          }}
        >
          {/* Unread dot */}
          {!read && (
            <div className='absolute left-1.5 top-1/2 -translate-y-1/2 size-1.5 rounded-full bg-blue-500' />
          )}

          <ItemMedia className='self-start'>
            <Avatar className='size-9'>
              <AvatarImage
                src={actor?.imageUrl ?? (!actor ? '/logo-dark.svg' : undefined)}
              />
              <AvatarFallback className='text-[10px]'>
                {actor ? getInitials(actor.name) : 'LA'}
              </AvatarFallback>
            </Avatar>
          </ItemMedia>

          <ItemContent>
            <p className='text-xs leading-snug text-foreground'>
              <span className='font-semibold'>{actor?.name ?? 'Lumo AI'}</span>{' '}
              {verb}{' '}
              <span className='font-medium'>
                {task ? `${task.teamIdentifier}-${task.number}` : 'a task'}
              </span>
              {task && (
                <span className='text-muted-foreground'>{` ${task.title}`}</span>
              )}
            </p>

            {commentPreview && type === 'TASK_MENTIONED' && (
              <p className='text-xs text-muted-foreground line-clamp-2'>
                <CommentPreview body={commentPreview} />
              </p>
            )}

            <p className='text-[10px] text-muted-foreground'>{timeAgo}</p>

            {/* AGENT_CLARIFY: inline reply widget */}
            {type === 'AGENT_CLARIFY' && pendingAction && (
              <AgentClarifyWidget
                notification={notification}
                onRespond={(id, action, reply) => onRespond(id, action, reply)}
              />
            )}

            {/* AGENT_AUTHORIZE: approve / deny buttons */}
            {type === 'AGENT_AUTHORIZE' && pendingAction && (
              <AgentAuthorizeWidget
                notification={notification}
                onRespond={(id, action) => onRespond(id, action)}
              />
            )}

            {/* AGENT_VERIFY: confirm / send back buttons */}
            {type === 'AGENT_VERIFY' && pendingAction && (
              <AgentVerifyWidget
                notification={notification}
                onRespond={(id, action) => onRespond(id, action)}
              />
            )}

            {/* TASK_IN_REVIEW: done / send back task status buttons */}
            {wasUnreadOnMount && type === 'TASK_IN_REVIEW' && (
              <ItemActions
                className='mt-0.5'
                onClick={e => e.stopPropagation()}
              >
                <Button
                  size='sm'
                  className={cn(
                    'h-6 text-[11px] px-2',
                    taskActionTaken === 'IN_PROGRESS' && 'opacity-40'
                  )}
                  onClick={() => {
                    setTaskActionTaken('DONE')
                    onTaskAction('DONE')
                    onMarkRead()
                  }}
                >
                  <CheckCheck data-icon='inline-start' />
                  Done
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  className={cn(
                    'h-6 text-[11px] px-2',
                    taskActionTaken === 'DONE' && 'opacity-40'
                  )}
                  onClick={() => {
                    setTaskActionTaken('IN_PROGRESS')
                    onTaskAction('IN_PROGRESS')
                    onMarkRead()
                  }}
                >
                  <RotateCcw data-icon='inline-start' />
                  Send back
                </Button>
              </ItemActions>
            )}
          </ItemContent>
        </Item>
      </ContextMenuTrigger>
      <ContextMenuContent className='w-52'>
        <ContextMenuItem
          onClick={e => {
            e.stopPropagation()
            read ? onMarkUnread() : onMarkRead()
          }}
        >
          Mark as {read ? 'unread' : 'read'}
          <ContextMenuShortcut>U</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          className='text-destructive focus:text-destructive'
          onClick={e => {
            e.stopPropagation()
            onDelete()
          }}
        >
          Delete notification
          <ContextMenuShortcut>⌫</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
