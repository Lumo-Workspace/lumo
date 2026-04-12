'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { CheckCheck, RotateCcw } from 'lucide-react'
import { ApiNotification } from '../../../types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Item, ItemContent, ItemMedia, ItemActions } from '@/components/ui/item'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { getInitials } from '@/lib/utils/getInitials'
import {
  AgentClarifyWidget,
  AgentVerifyWidget,
  AgentAuthorizeWidget,
} from './AgentWidgets'
import type { NotificationItemProps } from './types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Render comment body with @[clerkId] replaced by highlighted @mention spans */
export function CommentPreview({ body }: { body: string }) {
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
}: NotificationItemProps) {
  const intlLocal = useIntl()
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

  const timeAgo = (() => {
    const rtf = new Intl.RelativeTimeFormat(intlLocal.locale, {
      numeric: 'auto',
    })
    const diff = Date.now() - new Date(createdAt).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return rtf.format(0, 'second')
    if (mins < 60) return rtf.format(-mins, 'minute')
    const hours = Math.floor(mins / 60)
    if (hours < 24) return rtf.format(-hours, 'hour')
    const days = Math.floor(hours / 24)
    if (days < 30) return rtf.format(-days, 'day')
    const months = Math.floor(days / 30)
    return rtf.format(-months, 'month')
  })()

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
