'use client'

import { useState, useEffect, useCallback } from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'
import { X, ArrowLeftToLine, ArrowRightToLine, UserCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  TaskDetail,
  ApiTask,
  MyTask,
  ApiStatus,
  WorkspaceMemberInfo,
  ApiProject,
} from '../types'
import { API_STATUS_LABEL } from '../utils'
import { StatusIcon } from './StatusIcon'
import { DescriptionEditor } from './DescriptionEditor'
import { TypographyH3 } from '@/components/ui/typography'

// Palette for initials fallback — cycles by name char code
const AVATAR_COLORS = [
  'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
]

function memberColor(name: string) {
  const code = name.charCodeAt(0) + (name.charCodeAt(1) ?? 0)
  return AVATAR_COLORS[code % AVATAR_COLORS.length]
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function MemberAvatar({
  member,
  size = 'sm',
}: {
  member: WorkspaceMemberInfo
  size?: 'sm' | 'xs'
}) {
  const dim = size === 'xs' ? 'size-4' : 'size-5'
  const textSize = size === 'xs' ? 'text-[9px]' : 'text-[10px]'
  return (
    <Avatar className={`${dim} shrink-0`}>
      <AvatarImage src={member.imageUrl ?? undefined} alt={member.name} />
      <AvatarFallback
        className={`${memberColor(member.name)} ${textSize} font-semibold`}
      >
        {getInitials(member.name)}
      </AvatarFallback>
    </Avatar>
  )
}

interface TaskDrawerProps {
  initialTask: ApiTask | MyTask
  cachedDescription?: string | null | undefined
  onClose: () => void
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
    }>
  ) => Promise<void>
  onDescriptionLoaded?: (taskId: string, description: string | null) => void
}

export function TaskDrawer({
  initialTask,
  cachedDescription,
  onClose,
  members,
  projects,
  onUpdate,
  onDescriptionLoaded,
}: TaskDrawerProps) {
  // Seed visible fields instantly from cached list data
  const [task, setTask] = useState<TaskDetail>(() => ({
    id: initialTask.id,
    title: initialTask.title,
    status: initialTask.status,
    priority: initialTask.priority,
    projectId: initialTask.projectId,
    project:
      'project' in initialTask && initialTask.project
        ? initialTask.project
        : { id: initialTask.projectId, name: '' },
    parentTaskId: initialTask.parentTaskId,
    assigneeId: initialTask.assigneeId,
    assignee: null,
    description: null,
    updatedAt: initialTask.updatedAt,
  }))
  const [expanded, setExpanded] = useState(false)
  // Seed from cache so returning to a task shows description instantly
  const hasCached = cachedDescription !== undefined
  const [descriptionValue, setDescriptionValue] = useState<string | null>(
    hasCached ? cachedDescription : null
  )
  const [descriptionLoading, setDescriptionLoading] = useState(!hasCached)

  // Fetch full detail in background — only updates description + project name
  useEffect(() => {
    // Only show loading spinner when there's no cached content to show
    if (!hasCached) setDescriptionLoading(true)
    fetch(`/api/tasks/${initialTask.id}`)
      .then(async r => {
        const data = await r.json()
        if (!r.ok || !data.task)
          throw new Error(data.error ?? 'Failed to load task')
        return data as { task: TaskDetail }
      })
      .then(({ task: t }) => {
        // Only take fields that aren't user-editable in the drawer
        // (description + project name). Never overwrite status/assigneeId/title
        // which may have already been changed optimistically.
        setTask(prev => ({
          ...prev,
          description: t.description,
          project: t.project,
        }))
        setDescriptionValue(t.description ?? null)
        onDescriptionLoaded?.(t.id, t.description ?? null)
      })
      .catch(console.error)
      .finally(() => setDescriptionLoading(false))
  }, [initialTask.id])

  const handlePatch = useCallback(
    async (
      data: Partial<{
        title: string
        status: ApiStatus
        assigneeId: string | null
        description: string | null
        projectId: string
      }>
    ) => {
      const snapshot = task
      // Enrich local state: if projectId changed, also update embedded project name
      const localUpdate = { ...task, ...data }
      if (data.projectId) {
        const newProject = projects.find(p => p.id === data.projectId)
        if (newProject)
          localUpdate.project = { id: newProject.id, name: newProject.name }
      }
      setTask(localUpdate)
      try {
        await onUpdate(task.id, data)
      } catch {
        setTask(snapshot)
      }
    },
    [task, onUpdate, projects]
  )

  const commitDescription = useCallback(
    (html: string | null) => {
      const next = html?.trim() || null
      if (next === (task.description ?? null)) return
      handlePatch({ description: next })
    },
    [task.description, handlePatch]
  )

  return (
    <DrawerPrimitive.Root
      open
      onOpenChange={open => {
        if (!open) onClose()
      }}
      direction='right'
      dismissible={false}
    >
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay
          className='fixed inset-0 z-40 bg-black/10 dark:bg-black/30'
          onClick={onClose}
        />
        <DrawerPrimitive.Content
          className='fixed right-0 top-0 bottom-0 z-50 bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 flex flex-col shadow-2xl outline-none'
          style={{
            width: expanded ? '100vw' : '380px',
            transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') onClose()
          }}
        >
          {/* Header */}
          <DrawerPrimitive.Title className='sr-only'>
            Task detail
          </DrawerPrimitive.Title>
          <div className='flex items-center justify-between px-5 pt-4 shrink-0'>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => setExpanded(e => !e)}
              className='h-7 w-7 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? (
                <ArrowRightToLine size={14} />
              ) : (
                <ArrowLeftToLine size={14} />
              )}
            </Button>
            <Button
              variant='ghost'
              size='icon'
              onClick={onClose}
              className='h-7 w-7 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            >
              <X size={14} />
            </Button>
          </div>

          {/* Body */}
          <div className='flex-1 overflow-y-auto px-5 py-4'>
            <div className='space-y-1'>
              {/* Title */}
              <TypographyH3
                key={task.id}
                contentEditable
                suppressContentEditableWarning
                onBlur={e => {
                  const trimmed = e.currentTarget.textContent?.trim() ?? ''
                  if (!trimmed || trimmed === task.title) {
                    e.currentTarget.textContent = task.title
                    return
                  }
                  handlePatch({ title: trimmed })
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.currentTarget.blur()
                  }
                  if (e.key === 'Escape') {
                    e.currentTarget.textContent = task.title
                    e.currentTarget.blur()
                  }
                }}
                className='mb-4 cursor-text outline-none focus:outline-none'
              >
                {task.title}
              </TypographyH3>

              {/* Status · Assignee · Project — single inline row, no labels */}
              <div className='flex items-center gap-1 flex-wrap -ml-2 mb-1'>
                {/* Status */}
                <Select
                  value={task.status}
                  onValueChange={v => handlePatch({ status: v as ApiStatus })}
                >
                  <SelectTrigger className='h-7 text-xs border-none shadow-none bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800 px-2 w-auto gap-1.5 focus:ring-0 rounded-md'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.entries(API_STATUS_LABEL) as [ApiStatus, string][]
                    ).map(([val, label]) => (
                      <SelectItem key={val} value={val}>
                        <div className='flex items-center gap-2'>
                          <StatusIcon status={val} />
                          {label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <span className='text-zinc-200 dark:text-zinc-700 select-none'>
                  ·
                </span>

                {/* Assignee */}
                <Select
                  value={task.assigneeId ?? '__unassigned__'}
                  onValueChange={v =>
                    handlePatch({
                      assigneeId: v === '__unassigned__' ? null : v,
                    })
                  }
                >
                  <SelectTrigger className='h-7 text-xs border-none shadow-none bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800 px-2 w-auto gap-1.5 focus:ring-0 rounded-md'>
                    {(() => {
                      const assignee = members.find(
                        m => m.id === task.assigneeId
                      )
                      return assignee ? (
                        <div className='flex items-center gap-1.5'>
                          <MemberAvatar member={assignee} size='xs' />
                          <span>{assignee.name}</span>
                        </div>
                      ) : (
                        <div className='flex items-center gap-1.5 text-zinc-400'>
                          <UserCircle2 size={14} />
                          <span>No assignee</span>
                        </div>
                      )
                    })()}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='__unassigned__'>
                      <div className='flex items-center gap-2'>
                        <UserCircle2
                          size={20}
                          className='text-zinc-400 shrink-0'
                        />
                        <span className='text-zinc-400'>No assignee</span>
                      </div>
                    </SelectItem>
                    {members.map(m => (
                      <SelectItem key={m.id} value={m.id}>
                        <div className='flex items-center gap-2'>
                          <MemberAvatar member={m} size='sm' />
                          {m.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <span className='text-zinc-200 dark:text-zinc-700 select-none'>
                  ·
                </span>

                {/* Project */}
                <Select
                  value={task.projectId}
                  onValueChange={v => handlePatch({ projectId: v })}
                >
                  <SelectTrigger className='h-7 text-xs border-none shadow-none bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800 px-2 w-auto gap-1.5 focus:ring-0 rounded-md'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Description */}
              <div className='pt-4'>
                {descriptionLoading ? (
                  <span className='text-xs text-zinc-300 dark:text-zinc-600 animate-pulse'>
                    Loading…
                  </span>
                ) : (
                  <DescriptionEditor
                    value={descriptionValue}
                    onCommit={commitDescription}
                  />
                )}
              </div>
            </div>
          </div>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  )
}
