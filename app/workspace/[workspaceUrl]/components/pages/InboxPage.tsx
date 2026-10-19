'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { AnimatePresence, motion } from 'framer-motion'

import { Inbox, CheckCheck, Loader2, MessageSquare } from 'lucide-react'
import {
  ApiNotification,
  ApiStatus,
  ApiTask,
  WorkspaceMemberInfo,
  ApiProject,
  ApiPriority,
  TaskDetail,
} from '../../types'
import { API, CACHE_KEY } from '../../constants'
import { apiFetch } from '@/lib/api-client'
import { readCache, writeCache } from '../../cache'
import { queryKeys } from '@/lib/query/keys'
import { Button } from '@/components/ui/button'
import { ItemGroup } from '@/components/ui/item'
import { Separator } from '@/components/ui/separator'
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { PageBreadcrumb } from '../PageBreadcrumb'
import { TaskDetailPanel } from '../TaskDetailPanel'
import { NotificationItem, isPendingAction } from './inbox/NotificationItem'

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
  onUpdateTaskStatus: (taskId: string, status: ApiStatus) => Promise<void>
  members: WorkspaceMemberInfo[]
  projects: ApiProject[]
  onUpdate: (
    taskId: string,
    data: Partial<{
      title: string
      status: ApiStatus
      assigneeActorId: string | null
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
  onUpdateTaskStatus,
  members,
  projects,
  onUpdate,
}: InboxPageProps) {
  const intl = useIntl()
  const queryClient = useQueryClient()
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
      const cached = queryClient.getQueryData<TaskDetail>(
        queryKeys.tasks.detail(n.taskId)
      )
      if (cached) {
        setPanelTask(cached as unknown as ApiTask)
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
        queryClient.setQueryData<TaskDetail>(
          queryKeys.tasks.detail(task.id),
          prev => ({ ...(prev ?? {}), ...task }) as TaskDetail
        )
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
      } finally {
        if (activeNotifIdRef.current === n.id) {
          setPanelLoading(false)
        }
      }
    },
    [queryClient]
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
              className='h-7 text-caption gap-1.5 text-muted-foreground'
            >
              <CheckCheck size={13} />
              {intl.formatMessage({
                id: 'inbox.markAllRead',
                defaultMessage: 'Mark all as read',
              })}
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
                  className='flex gap-3 px-4 py-3 border-b border-border'
                >
                  <div className='size-7 rounded-full bg-muted animate-pulse shrink-0' />
                  <div className='flex-1 space-y-1.5'>
                    <div className='h-2.5 bg-muted rounded-sm animate-pulse w-3/4' />
                    <div className='h-2.5 bg-muted rounded-sm animate-pulse w-1/2' />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className='flex flex-col items-center justify-center h-full gap-3 text-muted-foreground p-4'>
              <p className='text-body text-center'>{error}</p>
              <Button variant='outline' size='sm' onClick={onRetry}>
                {intl.formatMessage({
                  id: 'common.retry',
                  defaultMessage: 'Retry',
                })}
              </Button>
            </div>
          ) : (
            <>
              {/* Actionable section */}
              {actionable.length > 0 && (
                <div className='px-2 pt-2 pb-0'>
                  <div className='flex items-center gap-1.5 px-1 pb-1'>
                    <MessageSquare size={11} className='text-info-text' />
                    <span className='text-caption text-info-text uppercase'>
                      {intl.formatMessage({
                        id: 'inbox.section.actionable',
                        defaultMessage: 'Needs your response',
                      })}
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
                      <span className='text-caption text-muted-foreground uppercase'>
                        {intl.formatMessage({
                          id: 'inbox.section.other',
                          defaultMessage: 'Other',
                        })}
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
                <div className='flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground'>
                  <Inbox size={24} className='text-muted-foreground/30' />
                  <p className='text-caption text-muted-foreground'>
                    {intl.formatMessage({
                      id: 'inbox.empty.allCaughtUp',
                      defaultMessage: "You're all caught up",
                    })}
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
        <div className='absolute inset-y-0 -left-1 -right-1 z-sticky' />
        <Separator
          orientation='vertical'
          className='group-hover:bg-muted-foreground transition-colors'
        />
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
                className='animate-spin text-muted-foreground'
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
              className='absolute inset-0 flex items-center justify-center text-muted-foreground'
            >
              <p className='text-body'>
                {intl.formatMessage({
                  id: 'inbox.noLinkedTask',
                  defaultMessage: 'No task linked to this notification.',
                })}
              </p>
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
              <p className='text-body text-muted-foreground'>
                {unreadCount > 0
                  ? intl.formatMessage(
                      {
                        id: 'inbox.unreadCount',
                        defaultMessage:
                          '{count, plural, one {# unread notification} other {# unread notifications}}',
                      },
                      { count: unreadCount }
                    )
                  : intl.formatMessage({
                      id: 'inbox.empty.allCaughtUp',
                      defaultMessage: "You're all caught up",
                    })}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
