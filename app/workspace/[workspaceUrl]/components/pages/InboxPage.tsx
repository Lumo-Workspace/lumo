'use client'

import { useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Inbox, CheckCheck, ArrowRight, RotateCcw } from 'lucide-react'
import { ApiNotification, ApiStatus } from '../../types'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

/** Render comment body with @[clerkId] replaced by highlighted @mention spans */
function CommentPreview({ body }: { body: string }) {
  const parts = body.split(/(@\[[^\]]+\])/)
  return (
    <span className='text-zinc-500 dark:text-zinc-400 text-xs line-clamp-2'>
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
    </span>
  )
}

// ─── Notification item ────────────────────────────────────────────────────────

function NotificationItem({
  notification,
  onOpen,
  onMarkRead,
  onTaskAction,
}: {
  notification: ApiNotification
  onOpen: () => void
  onMarkRead: () => void
  onTaskAction: (status: ApiStatus) => void
}) {
  const { actor, task, type, commentPreview, createdAt } = notification

  const headline =
    type === 'TASK_IN_REVIEW'
      ? { verb: 'submitted', connector: 'for review —' }
      : type === 'TASK_SENT_BACK'
        ? { verb: 'sent back', connector: 'to In Progress —' }
        : type === 'TASK_ASSIGNED'
          ? { verb: 'assigned you to', connector: '—' }
          : { verb: 'mentioned you in', connector: '—' }

  const timeAgo = formatDistanceToNow(new Date(createdAt), { addSuffix: true })

  const { read } = notification

  return (
    <div
      className={`group relative flex gap-3 px-6 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 cursor-pointer border-b border-zinc-100 dark:border-zinc-900 transition-colors ${read ? 'opacity-60' : ''}`}
      onClick={() => {
        onOpen()
        if (!read) onMarkRead()
      }}
    >
      {/* Unread dot — only shown when unread */}
      {!read && (
        <div className='absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0' />
      )}

      {/* Actor avatar */}
      <Avatar className='size-8 shrink-0 mt-0.5'>
        <AvatarImage src={actor?.imageUrl ?? undefined} />
        <AvatarFallback className='text-[10px]'>
          {actor ? getInitials(actor.name) : '?'}
        </AvatarFallback>
      </Avatar>

      {/* Content */}
      <div className='flex-1 min-w-0'>
        <p className='text-sm text-zinc-700 dark:text-zinc-300'>
          <span className='font-semibold text-zinc-900 dark:text-zinc-100'>
            {actor?.name ?? 'Someone'}
          </span>{' '}
          {headline.verb}{' '}
          <span className='font-medium text-zinc-900 dark:text-zinc-100'>
            {task ? `${task.teamIdentifier}-${task.number}` : 'a task'}
          </span>
          {task && (
            <span className='text-zinc-500 dark:text-zinc-400'>{` ${task.title}`}</span>
          )}
        </p>

        {commentPreview && type === 'TASK_MENTIONED' && (
          <div className='mt-1'>
            <CommentPreview body={commentPreview} />
          </div>
        )}

        <p className='mt-1 text-[11px] text-zinc-400 dark:text-zinc-500'>
          {timeAgo}
        </p>

        {/* Action buttons — only on unread notifications */}
        {!read && (
          <div
            className='flex items-center gap-2 mt-2'
            onClick={e => e.stopPropagation()}
          >
            {type === 'TASK_IN_REVIEW' && (
              <>
                <Button
                  size='sm'
                  variant='default'
                  className='h-7 text-xs gap-1.5'
                  onClick={() => {
                    onTaskAction('DONE')
                    onMarkRead()
                  }}
                >
                  <CheckCheck size={13} />
                  Mark done
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  className='h-7 text-xs gap-1.5'
                  onClick={() => {
                    onTaskAction('IN_PROGRESS')
                    onMarkRead()
                  }}
                >
                  <RotateCcw size={13} />
                  Send back
                </Button>
              </>
            )}
            <Button
              size='sm'
              variant='ghost'
              className='h-7 text-xs gap-1 text-zinc-500'
              onClick={() => {
                onOpen()
                onMarkRead()
              }}
            >
              View task
              <ArrowRight size={12} />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── InboxPage ────────────────────────────────────────────────────────────────

interface InboxPageProps {
  notifications: ApiNotification[]
  unreadCount: number
  loading: boolean
  error: string | null
  onRetry: () => void
  onMount: () => void
  onMarkOneRead: (id: string) => void
  onMarkAllRead: () => void
  onOpenTask: (taskId: string, commentId?: string | null) => void
  onUpdateTaskStatus: (taskId: string, status: ApiStatus) => Promise<void>
}

export function InboxPage({
  notifications,
  unreadCount,
  loading,
  error,
  onRetry,
  onMount,
  onMarkOneRead,
  onMarkAllRead,
  onOpenTask,
  onUpdateTaskStatus,
}: InboxPageProps) {
  useEffect(() => {
    onMount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className='h-full flex flex-col overflow-hidden'>
      {/* Header */}
      <div className='px-6 pt-4 pb-3 flex items-center justify-between shrink-0'>
        <h2 className='text-sm font-semibold text-zinc-900 dark:text-zinc-100'>
          Inbox
          {unreadCount > 0 && (
            <span className='ml-2 text-[11px] bg-blue-500 text-white rounded-full px-1.5 py-0.5 font-bold'>
              {unreadCount}
            </span>
          )}
        </h2>
        {unreadCount > 0 && (
          <Button
            variant='ghost'
            size='sm'
            onClick={onMarkAllRead}
            className='h-7 text-xs gap-1.5 text-zinc-500'
          >
            <CheckCheck size={13} />
            Mark all as read
          </Button>
        )}
      </div>

      {/* Body */}
      <div className='flex-1 overflow-y-auto'>
        {loading && notifications.length === 0 ? (
          <div className='space-y-0'>
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className='flex gap-3 px-6 py-4 border-b border-zinc-100 dark:border-zinc-900'
              >
                <div className='size-8 rounded-full bg-zinc-100 dark:bg-zinc-800 animate-pulse shrink-0' />
                <div className='flex-1 space-y-2'>
                  <div className='h-3 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse w-3/4' />
                  <div className='h-3 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse w-1/2' />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className='flex flex-col items-center justify-center h-full gap-3 text-zinc-400'>
            <p className='text-sm'>{error}</p>
            <Button variant='outline' size='sm' onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : notifications.length === 0 && !loading ? (
          <div className='flex flex-col items-center justify-center h-full gap-3 text-zinc-400 pb-16'>
            <div className='size-12 rounded-xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center'>
              <Inbox size={22} className='text-zinc-400' />
            </div>
            <p className='text-sm font-medium text-zinc-500 dark:text-zinc-400'>
              You're all caught up
            </p>
          </div>
        ) : (
          notifications.map(n => (
            <NotificationItem
              key={n.id}
              notification={n}
              onOpen={() => {
                if (n.taskId) onOpenTask(n.taskId, n.commentId)
              }}
              onMarkRead={() => onMarkOneRead(n.id)}
              onTaskAction={(status: ApiStatus) => {
                if (n.taskId) onUpdateTaskStatus(n.taskId, status)
              }}
            />
          ))
        )}
      </div>
    </div>
  )
}
