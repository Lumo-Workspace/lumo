'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useIntl } from 'react-intl'
import { AnimatePresence, motion } from 'framer-motion'

import {
  Inbox,
  CheckCheck,
  RotateCcw,
  Loader2,
  MessageSquare,
  SendHorizonal,
  ThumbsUp,
  ShieldCheck,
  ShieldX,
} from 'lucide-react'
import {
  ApiNotification,
  ApiStatus,
  ApiTask,
  WorkspaceMemberInfo,
  ApiProject,
  ApiPriority,
} from '../../types'
import { API, CACHE_KEY } from '../../constants'
import { apiFetch } from '@/lib/api-client'
import { readCache, writeCache } from '../../cache'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Item,
  ItemGroup,
  ItemMedia,
  ItemContent,
  ItemActions,
} from '@/components/ui/item'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { PageBreadcrumb } from '../PageBreadcrumb'
import { TaskDetailPanel } from '../TaskDetailPanel'
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
function isPendingAction(n: ApiNotification): boolean {
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

function NotificationItem({
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

// ─── InboxPage ────────────────────────────────────────────────────────────────

interface InboxPageProps {
  notifications: ApiNotification[]
  unreadCount: number
  loading: boolean
  error: string | null
  onRetry: () => void
  onMount: () => void
  onMarkOneRead: (id: string) => void
  onMarkOneUnread: (id: string) => void
  onDeleteOne: (id: string) => void
  onMarkAllRead: () => void
  onRespondToNotification: (
    id: string,
    action: 'reply' | 'confirm' | 'send_back' | 'approve' | 'deny',
    reply?: string
  ) => void
  onUpdateTaskStatus: (taskId: string, status: ApiStatus) => Promise<void>
  members: WorkspaceMemberInfo[]
  projects: ApiProject[]
  taskMap?: Record<string, ApiTask>
  upsertTasks?: (tasks: ApiTask[]) => void
  onUpdate: (
    taskId: string,
    data: Partial<{
      title: string
      status: ApiStatus
      assigneeActorId: string | null
      reviewerActorId: string | null
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
  onMarkOneUnread,
  onDeleteOne,
  onMarkAllRead,
  onRespondToNotification,
  onUpdateTaskStatus,
  members,
  projects,
  taskMap,
  upsertTasks,
  onUpdate,
}: InboxPageProps) {
  const intl = useIntl()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelTask, setPanelTask] = useState<ApiTask | null>(null)
  const [panelLoading, setPanelLoading] = useState(false)
  const activeAbortRef = useRef<AbortController | null>(null)
  const activeNotifIdRef = useRef<string | null>(null)

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

  // Keyboard shortcuts for selected notification
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectedId) return
      const tag = (e.target as HTMLElement)?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (e.target as HTMLElement)?.isContentEditable
      )
        return
      const n = notifications.find(n => n.id === selectedId)
      if (!n) return
      if (e.key === 'u' || e.key === 'U') {
        e.preventDefault()
        n.read ? onMarkOneUnread(selectedId) : onMarkOneRead(selectedId)
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        onDeleteOne(selectedId)
        setSelectedId(null)
        setPanelTask(null)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [selectedId, notifications, onMarkOneRead, onMarkOneUnread, onDeleteOne])

  const selectNotification = useCallback(
    async (n: ApiNotification) => {
      // Cancel any in-flight fetch from the previous selection
      activeAbortRef.current?.abort()
      const controller = new AbortController()
      activeAbortRef.current = controller
      activeNotifIdRef.current = n.id

      setSelectedId(n.id)

      if (!n.taskId) {
        setPanelTask(null)
        setPanelLoading(false)
        return
      }

      // Show cached task immediately if available, otherwise clear + show spinner
      const cached = taskMap?.[n.taskId]
      if (cached) {
        setPanelTask(cached)
        setPanelLoading(false)
      } else {
        setPanelTask(null)
        setPanelLoading(true)
      }

      try {
        const { task } = await apiFetch<{ task: ApiTask }>(
          API.tasks.byId(n.taskId),
          {
            signal: controller.signal,
          }
        )
        // Ignore stale responses if the user has already moved on
        if (activeNotifIdRef.current !== n.id) return
        setPanelTask(task)
        upsertTasks?.([task])
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
      } finally {
        if (activeNotifIdRef.current === n.id) {
          setPanelLoading(false)
        }
      }
    },
    [taskMap, upsertTasks]
  )

  const selectedNotification = notifications.find(n => n.id === selectedId)

  // Split into actionable (pending) and informational
  const actionable = notifications.filter(isPendingAction)
  const informational = notifications.filter(n => !isPendingAction(n))

  const renderItem = (n: ApiNotification) => (
    <NotificationItem
      key={n.id}
      notification={n}
      isSelected={n.id === selectedId}
      onSelect={() => {
        selectNotification(n)
        if (!n.read) onMarkOneRead(n.id)
      }}
      onMarkRead={() => onMarkOneRead(n.id)}
      onMarkUnread={() => onMarkOneUnread(n.id)}
      onDelete={() => {
        onDeleteOne(n.id)
        if (selectedId === n.id) {
          setSelectedId(null)
          setPanelTask(null)
        }
      }}
      onTaskAction={(status: ApiStatus) => {
        if (n.taskId) onUpdateTaskStatus(n.taskId, status)
      }}
      onRespond={onRespondToNotification}
    />
  )

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
                <BreadcrumbPage>
                  {intl.formatMessage({ id: 'sidebar.inbox' })}
                </BreadcrumbPage>
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

        <div
          className='flex-1 overflow-y-auto'
          onClick={() => {
            setSelectedId(null)
            setPanelTask(null)
          }}
        >
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
          ) : (
            <>
              {/* Actionable section */}
              {actionable.length > 0 && (
                <div className='px-2 pt-2 pb-0'>
                  <div className='flex items-center gap-1.5 px-1 pb-1'>
                    <MessageSquare size={11} className='text-blue-500' />
                    <span className='text-[10px] font-medium text-blue-500 uppercase tracking-wide'>
                      Needs your response
                    </span>
                  </div>
                  <ItemGroup className='flex flex-col gap-1'>
                    {actionable.map(renderItem)}
                  </ItemGroup>
                </div>
              )}

              {/* Informational section */}
              {informational.length > 0 && (
                <div className='px-2 pt-2 pb-1.5'>
                  {actionable.length > 0 && (
                    <div className='flex items-center gap-1.5 px-1 pb-1'>
                      <span className='text-[10px] font-medium text-muted-foreground uppercase tracking-wide'>
                        Other
                      </span>
                    </div>
                  )}
                  <ItemGroup className='flex flex-col gap-1.5'>
                    {informational.map(renderItem)}
                  </ItemGroup>
                </div>
              )}

              {/* Empty state */}
              {notifications.length === 0 && (
                <div className='flex flex-col items-center justify-center py-16 gap-2 text-zinc-400'>
                  <Inbox size={24} className='text-muted-foreground/30' />
                  <p className='text-xs text-muted-foreground'>
                    {"You're all caught up"}
                  </p>
                </div>
              )}
            </>
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
      <div className='flex-1 flex flex-col overflow-hidden relative'>
        <AnimatePresence mode='wait'>
          {panelLoading ? (
            <motion.div
              key='loading'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0 } }}
              transition={{ duration: 0.1 }}
              className='absolute inset-0 flex items-center justify-center'
            >
              <Loader2
                size={20}
                className='animate-spin text-zinc-300 dark:text-zinc-600'
              />
            </motion.div>
          ) : panelTask ? (
            <motion.div
              key={panelTask.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0 } }}
              transition={{ duration: 0.12 }}
              className='absolute inset-0 flex flex-col'
            >
              <TaskDetailPanel
                initialTask={panelTask}
                cachedDescription={
                  readCache<{ desc: string | null }>(
                    CACHE_KEY.description(panelTask.id)
                  )?.desc
                }
                onDescriptionLoaded={(taskId, description) => {
                  writeCache(CACHE_KEY.description(taskId), {
                    desc: description,
                  })
                }}
                members={members}
                projects={projects}
                onUpdate={onUpdate}
              />
            </motion.div>
          ) : selectedNotification && !selectedNotification.taskId ? (
            <motion.div
              key='no-task'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0 } }}
              transition={{ duration: 0.1 }}
              className='absolute inset-0 flex items-center justify-center text-zinc-400'
            >
              <p className='text-sm'>No task linked to this notification.</p>
            </motion.div>
          ) : (
            <motion.div
              key='empty'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0 } }}
              transition={{ duration: 0.1 }}
              className='absolute inset-0 flex flex-col items-center justify-center gap-3 pb-16'
            >
              <Inbox size={32} className='text-muted-foreground/30' />
              <p className='text-sm text-muted-foreground'>
                {unreadCount > 0
                  ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}`
                  : "You're all caught up"}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
