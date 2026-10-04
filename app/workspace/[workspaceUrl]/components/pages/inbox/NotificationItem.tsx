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
// Agent widgets hidden — agent features disabled for now
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
}: NotificationItemProps) {
  const intlLocal = useIntl()
  const {
    actor,
    task,
    sprint,
    project,
    milestone,
    document,
    type,
    commentPreview,
    createdAt,
    read,
  } = notification

  // URL of the mentioned entity for project/milestone/document mention
  // notifications. Task/sprint notifications keep the existing in-page
  // detail-panel selection flow (no href), so this stays null for them.
  const entityUrl =
    type === 'PROJECT_MENTIONED'
      ? (project?.url ?? null)
      : type === 'MILESTONE_MENTIONED'
        ? (milestone?.url ?? null)
        : type === 'DOCUMENT_MENTIONED' || type === 'DOCUMENT_COMMENT_MENTIONED'
          ? (document?.url ?? null)
          : null

  // Track which review action was taken this session so buttons stay visible
  // after clicking instead of disappearing when read flips to true.
  // wasUnreadOnMount captures whether to show buttons at all (we don't show
  // action buttons for notifications that were already read on page load).
  const [wasUnreadOnMount] = useState(!read)
  const [taskActionTaken, setTaskActionTaken] = useState<
    'DONE' | 'IN_PROGRESS' | null
  >(null)

  const pendingAction = isPendingAction(notification)

  const VERB: Record<ApiNotification['type'], string> = {
    TASK_IN_REVIEW: intlLocal.formatMessage({
      id: 'notification.verb.taskInReview',
      defaultMessage: 'submitted for review',
    }),
    TASK_SENT_BACK: intlLocal.formatMessage({
      id: 'notification.verb.taskSentBack',
      defaultMessage: 'sent back to In Progress',
    }),
    TASK_ASSIGNED: intlLocal.formatMessage({
      id: 'notification.verb.taskAssigned',
      defaultMessage: 'assigned you to',
    }),
    TASK_MENTIONED: intlLocal.formatMessage({
      id: 'notification.verb.taskMentioned',
      defaultMessage: 'mentioned you in',
    }),
    TASK_DONE: intlLocal.formatMessage({
      id: 'notification.verb.taskDone',
      defaultMessage: 'marked as done',
    }),
    TASK_SPEC_READY: intlLocal.formatMessage({
      id: 'notification.verb.taskSpecReady',
      defaultMessage: 'generated a spec draft for',
    }),
    AGENT_CLARIFY: intlLocal.formatMessage({
      id: 'notification.verb.agentClarify',
      defaultMessage: 'has a question about',
    }),
    AGENT_AUTHORIZE: intlLocal.formatMessage({
      id: 'notification.verb.agentAuthorize',
      defaultMessage: 'needs your approval for',
    }),
    AGENT_VERIFY: intlLocal.formatMessage({
      id: 'notification.verb.agentVerify',
      defaultMessage: 'completed work on',
    }),
    AGENT_FAILED: intlLocal.formatMessage({
      id: 'notification.verb.agentFailed',
      defaultMessage: 'failed on',
    }),
    AGENT_DONE: intlLocal.formatMessage({
      id: 'notification.verb.agentDone',
      defaultMessage: 'finished work on',
    }),
    SPRINT_STARTED: intlLocal.formatMessage({
      id: 'notification.verb.sprintStarted',
      defaultMessage: 'started sprint',
    }),
    SPRINT_CLOSED: intlLocal.formatMessage({
      id: 'notification.verb.sprintClosed',
      defaultMessage: 'closed sprint',
    }),
    PROJECT_MENTIONED: intlLocal.formatMessage({
      id: 'notification.verb.projectMentioned',
      defaultMessage: 'mentioned you in',
    }),
    MILESTONE_MENTIONED: intlLocal.formatMessage({
      id: 'notification.verb.milestoneMentioned',
      defaultMessage: 'mentioned you in',
    }),
    DOCUMENT_MENTIONED: intlLocal.formatMessage({
      id: 'notification.verb.documentMentioned',
      defaultMessage: 'mentioned you in',
    }),
    DOCUMENT_COMMENT_MENTIONED: intlLocal.formatMessage({
      id: 'notification.verb.documentCommentMentioned',
      defaultMessage: 'mentioned you in a comment on',
    }),
  }
  const verb =
    VERB[type] ??
    intlLocal.formatMessage({
      id: 'notification.verb.generic',
      defaultMessage: 'sent you an update on',
    })

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
              <span className='font-semibold'>
                {actor?.name ??
                  intlLocal.formatMessage({
                    id: 'notification.defaultActor',
                    defaultMessage: 'Lumo AI',
                  })}
              </span>{' '}
              {verb}{' '}
              {type === 'SPRINT_STARTED' || type === 'SPRINT_CLOSED' ? (
                <span className='font-medium'>
                  {sprint?.name ??
                    intlLocal.formatMessage({
                      id: 'notification.unspecifiedSprint',
                      defaultMessage: 'a sprint',
                    })}
                </span>
              ) : type === 'PROJECT_MENTIONED' && project ? (
                <a
                  href={entityUrl ?? undefined}
                  className='font-medium hover:underline'
                >
                  {project.name}
                </a>
              ) : type === 'MILESTONE_MENTIONED' && milestone ? (
                <a
                  href={entityUrl ?? undefined}
                  className='font-medium hover:underline'
                >
                  {milestone.name}
                </a>
              ) : (type === 'DOCUMENT_MENTIONED' ||
                  type === 'DOCUMENT_COMMENT_MENTIONED') &&
                document ? (
                <a
                  href={entityUrl ?? undefined}
                  className='font-medium hover:underline'
                >
                  {document.title}
                </a>
              ) : (
                <>
                  <span className='font-medium'>
                    {task
                      ? `${task.teamIdentifier}-${task.number}`
                      : intlLocal.formatMessage({
                          id: 'notification.unspecifiedTask',
                          defaultMessage: 'a task',
                        })}
                  </span>
                  {task && (
                    <span className='text-muted-foreground'>{` ${task.title}`}</span>
                  )}
                </>
              )}
            </p>

            {commentPreview && type === 'TASK_MENTIONED' && (
              <p className='text-xs text-muted-foreground line-clamp-2'>
                <CommentPreview body={commentPreview} />
              </p>
            )}

            <p className='text-[10px] text-muted-foreground'>{timeAgo}</p>

            {/* Agent notification widgets hidden — agent features disabled for now */}

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
                  {intlLocal.formatMessage({
                    id: 'notification.action.done',
                    defaultMessage: 'Done',
                  })}
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
                  {intlLocal.formatMessage({
                    id: 'notification.action.sendBack',
                    defaultMessage: 'Send back',
                  })}
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
          {read
            ? intlLocal.formatMessage({
                id: 'notification.menu.markUnread',
                defaultMessage: 'Mark as unread',
              })
            : intlLocal.formatMessage({
                id: 'notification.menu.markRead',
                defaultMessage: 'Mark as read',
              })}
          <ContextMenuShortcut>U</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          className='text-danger-text focus:text-danger-text'
          onClick={e => {
            e.stopPropagation()
            onDelete()
          }}
        >
          {intlLocal.formatMessage({
            id: 'notification.menu.delete',
            defaultMessage: 'Delete notification',
          })}
          <ContextMenuShortcut>⌫</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
