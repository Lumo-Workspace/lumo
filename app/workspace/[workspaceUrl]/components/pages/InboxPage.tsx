'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Inbox, CheckCheck, MessageSquare } from 'lucide-react'
import {
  ApiNotification,
  ApiStatus,
  ApiTask,
  WorkspaceMemberInfo,
  ApiProject,
  ApiPriority,
} from '../../types'
import { API } from '../../constants'
import { apiFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { ItemGroup } from '@/components/ui/item'
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { PageBreadcrumb } from '../PageBreadcrumb'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { NotificationDetailPanel } from '../NotificationDetailPanel'
import { NotificationItem, isPendingAction } from '../NotificationItem'

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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelTask, setPanelTask] = useState<ApiTask | null>(null)
  const [panelLoading, setPanelLoading] = useState(false)
  const activeAbortRef = useRef<AbortController | null>(null)
  const activeNotifIdRef = useRef<string | null>(null)

  const { width: leftWidth, handleDividerMouseDown } = useResizablePanel()

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
      <NotificationDetailPanel
        panelLoading={panelLoading}
        panelTask={panelTask}
        selectedNotification={selectedNotification}
        unreadCount={unreadCount}
        members={members}
        projects={projects}
        onUpdate={onUpdate}
      />
    </div>
  )
}
