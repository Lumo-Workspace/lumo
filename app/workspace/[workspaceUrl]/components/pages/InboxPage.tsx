'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Inbox, CheckCheck, ArrowRight, RotateCcw, Loader2 } from 'lucide-react'
import {
  ApiNotification,
  ApiStatus,
  ApiTask,
  WorkspaceMemberInfo,
  ApiProject,
  ApiPriority,
} from '../../types'
import { API } from '../../constants'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { PageBreadcrumb } from '../PageBreadcrumb'
import { TaskDetailPanel } from '../TaskDetailPanel'

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  isSelected,
  onSelect,
  onMarkRead,
  onTaskAction,
}: {
  notification: ApiNotification
  isSelected: boolean
  onSelect: () => void
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
      className={`group relative flex gap-3 px-4 py-3 cursor-pointer border-b border-zinc-100 dark:border-zinc-900 transition-colors ${
        isSelected
          ? 'bg-zinc-100 dark:bg-zinc-800/60'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
      } ${read ? 'opacity-60' : ''}`}
      onClick={() => {
        onSelect()
        if (!read) onMarkRead()
      }}
    >
      {/* Unread dot */}
      {!read && (
        <div className='absolute left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0' />
      )}

      {/* Actor avatar */}
      <Avatar className='size-7 shrink-0 mt-0.5'>
        <AvatarImage src={actor?.imageUrl ?? undefined} />
        <AvatarFallback className='text-[10px]'>
          {actor ? getInitials(actor.name) : '?'}
        </AvatarFallback>
      </Avatar>

      {/* Content */}
      <div className='flex-1 min-w-0'>
        <p className='text-xs text-zinc-700 dark:text-zinc-300 leading-snug'>
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
          <div className='mt-0.5'>
            <CommentPreview body={commentPreview} />
          </div>
        )}

        <p className='mt-1 text-[10px] text-zinc-400 dark:text-zinc-500'>
          {timeAgo}
        </p>

        {/* Action buttons — only on unread notifications */}
        {!read && (
          <div
            className='flex items-center gap-1.5 mt-1.5'
            onClick={e => e.stopPropagation()}
          >
            {type === 'TASK_IN_REVIEW' && (
              <>
                <Button
                  size='sm'
                  variant='default'
                  className='h-6 text-[11px] gap-1 px-2'
                  onClick={() => {
                    onTaskAction('DONE')
                    onMarkRead()
                  }}
                >
                  <CheckCheck size={11} />
                  Done
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  className='h-6 text-[11px] gap-1 px-2'
                  onClick={() => {
                    onTaskAction('IN_PROGRESS')
                    onMarkRead()
                  }}
                >
                  <RotateCcw size={11} />
                  Send back
                </Button>
              </>
            )}
            <Button
              size='sm'
              variant='ghost'
              className='h-6 text-[11px] gap-0.5 px-1.5 text-zinc-500'
              onClick={() => {
                onSelect()
                onMarkRead()
              }}
            >
              View
              <ArrowRight size={10} />
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
  onUpdateTaskStatus: (taskId: string, status: ApiStatus) => Promise<void>
  members: WorkspaceMemberInfo[]
  projects: ApiProject[]
  onUpdate: (
    taskId: string,
    data: Partial<{
      title: string
      status: ApiStatus
      assigneeId: string | null
      description: string | null
      projectId: string
      priority: ApiPriority
    }>
  ) => Promise<void>
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
  onUpdateTaskStatus,
  members,
  projects,
  onUpdate,
}: InboxPageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelTask, setPanelTask] = useState<ApiTask | null>(null)
  const [panelLoading, setPanelLoading] = useState(false)

  // ─── Resizable divider ────────────────────────────────────────────────────
  const [leftWidth, setLeftWidth] = useState(384) // default w-96
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true
      dragStartX.current = e.clientX
      dragStartWidth.current = leftWidth
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [leftWidth]
  )

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = e.clientX - dragStartX.current
      const next = Math.max(220, Math.min(600, dragStartWidth.current + delta))
      setLeftWidth(next)
    }
    const onMouseUp = () => {
      if (!isDragging.current) return
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  useEffect(() => {
    onMount()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-select first notification when list loads
  useEffect(() => {
    if (notifications.length > 0 && selectedId === null) {
      const first = notifications[0]
      if (first) selectNotification(first)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications.length])

  const selectNotification = useCallback(async (n: ApiNotification) => {
    setSelectedId(n.id)
    if (!n.taskId) {
      setPanelTask(null)
      return
    }
    setPanelLoading(true)
    try {
      const res = await fetch(API.tasks.byId(n.taskId))
      if (!res.ok) return
      const { task } = (await res.json()) as { task: ApiTask }
      setPanelTask(task)
    } finally {
      setPanelLoading(false)
    }
  }, [])

  const selectedNotification = notifications.find(n => n.id === selectedId)

  return (
    <div className='h-full flex overflow-hidden'>
      {/* ── Left column: breadcrumb + notification list ── */}
      <div
        className='shrink-0 flex flex-col overflow-hidden'
        style={{ width: leftWidth }}
      >
        <PageBreadcrumb>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Inbox</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
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
        </PageBreadcrumb>

        <div className='flex-1 overflow-y-auto'>
          {loading && notifications.length === 0 ? (
            <div className='space-y-0'>
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className='flex gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-900'
                >
                  <div className='size-7 rounded-full bg-zinc-100 dark:bg-zinc-800 animate-pulse shrink-0' />
                  <div className='flex-1 space-y-1.5'>
                    <div className='h-2.5 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse w-3/4' />
                    <div className='h-2.5 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse w-1/2' />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className='flex flex-col items-center justify-center h-full gap-3 text-zinc-400 p-4'>
              <p className='text-sm text-center'>{error}</p>
              <Button variant='outline' size='sm' onClick={onRetry}>
                Retry
              </Button>
            </div>
          ) : notifications.length === 0 && !loading ? (
            <div className='flex flex-col items-center justify-center h-full gap-3 text-zinc-400 pb-16'>
              <div className='size-10 rounded-xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center'>
                <Inbox size={18} className='text-zinc-400' />
              </div>
              <p className='text-xs font-medium text-zinc-500 dark:text-zinc-400'>
                You&apos;re all caught up
              </p>
            </div>
          ) : (
            notifications.map(n => (
              <NotificationItem
                key={n.id}
                notification={n}
                isSelected={n.id === selectedId}
                onSelect={() => {
                  selectNotification(n)
                  if (!n.read) onMarkOneRead(n.id)
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

      {/* ── Drag handle ── */}
      <div
        className='w-px shrink-0 relative cursor-col-resize group'
        onMouseDown={handleDividerMouseDown}
      >
        <div className='absolute inset-y-0 -left-1 -right-1 z-10' />
        <div className='h-full w-px bg-zinc-100 dark:bg-zinc-900 group-hover:bg-zinc-300 dark:group-hover:bg-zinc-700 transition-colors' />
      </div>

      {/* ── Right column: task detail panel ── */}
      <div className='flex-1 flex flex-col overflow-hidden'>
        {panelLoading ? (
          <div className='flex-1 flex items-center justify-center'>
            <Loader2
              size={20}
              className='animate-spin text-zinc-300 dark:text-zinc-600'
            />
          </div>
        ) : panelTask ? (
          <TaskDetailPanel
            key={panelTask.id}
            initialTask={panelTask}
            members={members}
            projects={projects}
            onUpdate={onUpdate}
          />
        ) : selectedNotification && !selectedNotification.taskId ? (
          <div className='flex-1 flex items-center justify-center text-zinc-400'>
            <p className='text-sm'>No task linked to this notification.</p>
          </div>
        ) : (
          <div className='flex-1 flex flex-col items-center justify-center gap-3 text-zinc-300 dark:text-zinc-700 pb-16'>
            <div className='size-12 rounded-xl bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center'>
              <Inbox size={22} className='text-zinc-300 dark:text-zinc-700' />
            </div>
            <p className='text-sm text-zinc-400 dark:text-zinc-500'>
              Select a notification to view details
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
