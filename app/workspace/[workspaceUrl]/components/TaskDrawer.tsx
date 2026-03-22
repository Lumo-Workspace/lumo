'use client'

import { useState, useEffect, useCallback } from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'
import { X, ArrowLeftToLine, ArrowRightToLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  TaskDetail,
  ApiTask,
  MyTask,
  ApiStatus,
  ApiPriority,
  WorkspaceMemberInfo,
  ApiProject,
} from '../types'
import { DescriptionEditor } from './DescriptionEditor'
import { TypographyH3 } from '@/components/ui/typography'
import {
  StatusSelect,
  AssigneeSelect,
  ProjectSelect,
  PrioritySelect,
  SeparatorDot,
  FIELD_TRIGGER_CLS,
} from './TaskFieldSelects'
import { Spinner } from '@/components/ui/spinner'

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
      priority: ApiPriority
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
    description: cachedDescription ?? null,
    updatedAt: initialTask.updatedAt,
    number: initialTask.number,
    teamIdentifier: initialTask.teamIdentifier,
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
          number: t.number,
          teamIdentifier: t.teamIdentifier,
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
        priority: ApiPriority
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
                className='mb-0 cursor-text outline-none focus:outline-none'
              >
                {task.title}
              </TypographyH3>
              {/* Status · Assignee · Project — single inline row, no labels */}
              <div className='flex items-center gap-1 flex-wrap -ml-2 mb-1'>
                <StatusSelect
                  value={task.status}
                  onChange={v => handlePatch({ status: v })}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
                <SeparatorDot />
                <AssigneeSelect
                  value={task.assigneeId ?? null}
                  onChange={v => handlePatch({ assigneeId: v })}
                  members={members}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
                <SeparatorDot />
                <ProjectSelect
                  value={task.projectId}
                  onChange={v => handlePatch({ projectId: v })}
                  projects={projects}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
                <SeparatorDot />
                <PrioritySelect
                  value={task.priority}
                  onChange={v => handlePatch({ priority: v })}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
              </div>

              {/* Description */}
              <div className='pt-4'>
                {descriptionLoading ? (
                  <Spinner className='size-4 text-zinc-300 dark:text-zinc-600' />
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
