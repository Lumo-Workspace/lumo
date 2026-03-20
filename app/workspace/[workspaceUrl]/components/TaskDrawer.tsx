'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'
import { X } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  TaskDetail,
  ApiTask,
  MyTask,
  ApiStatus,
  WorkspaceMemberInfo,
  ApiProject,
} from '../types'
import { API_STATUS_LABEL } from '../utils'
import { StatusDot } from './StatusDot'

interface TaskDrawerProps {
  initialTask: ApiTask | MyTask
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
    }>
  ) => Promise<void>
}

function FieldRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='flex items-start gap-4 py-2'>
      <span className='w-24 shrink-0 text-xs text-zinc-400 dark:text-zinc-500 pt-1.5 font-medium'>
        {label}
      </span>
      <div className='flex-1 min-w-0'>{children}</div>
    </div>
  )
}

export function TaskDrawer({
  initialTask,
  onClose,
  members,
  projects,
  onUpdate,
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
  const [title, setTitle] = useState(initialTask.title)
  const [description, setDescription] = useState('')
  const [descriptionLoading, setDescriptionLoading] = useState(true)

  // Fetch full detail in background — only updates description + project name
  useEffect(() => {
    setDescriptionLoading(true)
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
        setDescription(t.description ?? '')
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
      }>
    ) => {
      const snapshot = task
      setTask(prev => ({ ...prev, ...data }))
      try {
        await onUpdate(task.id, data)
      } catch {
        setTask(snapshot)
      }
    },
    [task, onUpdate]
  )

  const commitTitle = () => {
    const trimmed = title.trim()
    if (!trimmed || trimmed === task.title) return
    handlePatch({ title: trimmed })
  }

  const descRef = useRef<HTMLTextAreaElement>(null)
  const commitDescription = () => {
    const trimmed = description.trim() || null
    if (trimmed === (task.description ?? null)) return
    handlePatch({ description: trimmed })
  }

  useEffect(() => {
    const el = descRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [description])

  const project = projects.find(p => p.id === task.projectId) ?? task.project

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
          className='fixed right-0 top-0 bottom-0 z-50 w-[380px] bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 flex flex-col shadow-2xl outline-none'
          onKeyDown={e => {
            if (e.key === 'Escape') onClose()
          }}
        >
          {/* Header */}
          <DrawerPrimitive.Title className='sr-only'>
            Task detail
          </DrawerPrimitive.Title>
          <div className='flex items-center justify-end px-5 pt-4 shrink-0'>
            <button
              onClick={onClose}
              className='text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-900'
            >
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className='flex-1 overflow-y-auto px-5 py-4'>
            <div className='space-y-1'>
              {/* Title */}
              <textarea
                value={title}
                onChange={e => setTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitTitle()
                    ;(e.target as HTMLTextAreaElement).blur()
                  }
                  if (e.key === 'Escape') {
                    setTitle(task.title)
                    ;(e.target as HTMLTextAreaElement).blur()
                  }
                }}
                rows={1}
                className='w-full text-base font-semibold text-zinc-900 dark:text-zinc-100 bg-transparent border-none outline-none resize-none leading-snug mb-4 placeholder:text-zinc-300'
                style={{ overflow: 'hidden', height: 'auto' }}
                placeholder='Task title'
                ref={el => {
                  if (!el) return
                  el.style.height = 'auto'
                  el.style.height = `${el.scrollHeight}px`
                }}
              />

              <div className='divide-y divide-zinc-100 dark:divide-zinc-900'>
                {/* Status */}
                <FieldRow label='Status'>
                  <Select
                    value={task.status}
                    onValueChange={v => handlePatch({ status: v as ApiStatus })}
                  >
                    <SelectTrigger className='h-7 text-xs border-none shadow-none bg-transparent hover:bg-zinc-50 dark:hover:bg-zinc-900 px-2 -ml-2 w-auto gap-2 focus:ring-0'>
                      <div className='flex items-center gap-2'>
                        <StatusDot status={task.status} />
                        <SelectValue />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.entries(API_STATUS_LABEL) as [
                          ApiStatus,
                          string,
                        ][]
                      ).map(([val, label]) => (
                        <SelectItem key={val} value={val}>
                          <div className='flex items-center gap-2'>
                            <StatusDot status={val} />
                            {label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldRow>

                {/* Assignee */}
                <FieldRow label='Assignee'>
                  <Select
                    value={task.assigneeId ?? '__unassigned__'}
                    onValueChange={v =>
                      handlePatch({
                        assigneeId: v === '__unassigned__' ? null : v,
                      })
                    }
                  >
                    <SelectTrigger className='h-7 text-xs border-none shadow-none bg-transparent hover:bg-zinc-50 dark:hover:bg-zinc-900 px-2 -ml-2 w-auto gap-2 focus:ring-0'>
                      <SelectValue placeholder='Unassigned' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='__unassigned__'>
                        <span className='text-zinc-400'>Unassigned</span>
                      </SelectItem>
                      {members.map(m => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldRow>

                {/* Project */}
                <FieldRow label='Project'>
                  <span className='text-xs text-zinc-700 dark:text-zinc-300 py-1.5 block'>
                    {project?.name || task.project.name || '—'}
                  </span>
                </FieldRow>
              </div>

              {/* Description */}
              <div className='pt-4'>
                <p className='text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-2'>
                  Description
                </p>
                {descriptionLoading ? (
                  <span className='text-xs text-zinc-300 dark:text-zinc-600 animate-pulse'>
                    Loading…
                  </span>
                ) : (
                  <textarea
                    ref={descRef}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    onBlur={commitDescription}
                    onKeyDown={e => {
                      if (e.key === 'Escape') {
                        setDescription(task.description ?? '')
                        ;(e.target as HTMLTextAreaElement).blur()
                      }
                    }}
                    placeholder='Add a description…'
                    className='w-full text-sm text-zinc-700 dark:text-zinc-300 bg-transparent border-none outline-none resize-none leading-relaxed placeholder:text-zinc-300 dark:placeholder:text-zinc-600 min-h-[80px]'
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
