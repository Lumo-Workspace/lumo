'use client'

import { useState, useEffect, useRef } from 'react'
import { AnimatePresence } from 'motion/react'
import { Modal } from '../Modal'
import {
  ApiProject,
  ApiPriority,
  ApiStatus,
  WorkspaceMemberInfo,
} from '../../types'
import { isSubmitShortcut, submitModLabel } from '../../utils'
import { Button } from '@/components/ui/button'
import {
  StatusSelect,
  AssigneeSelect,
  ProjectSelect,
  PrioritySelect,
  FIELD_TRIGGER_CLS,
} from '../TaskFieldSelects'
import { DescriptionEditor } from '../DescriptionEditor'

export interface NewTaskFormData {
  title: string
  description: string
  status: ApiStatus
  priority: ApiPriority
  projectId: string
  assigneeId: string
}

interface NewTaskModalProps {
  isOpen: boolean
  onClose: () => void
  projects: ApiProject[]
  members: WorkspaceMemberInfo[]
  defaultProjectId?: string | undefined
  defaultAssigneeId?: string | undefined
  defaultStatus?: ApiStatus | undefined
  /** Parent handles optimistic create + API call. Throw to show error in modal. */
  onSubmit: (data: NewTaskFormData) => Promise<void>
}

export function NewTaskModal({
  isOpen,
  onClose,
  projects,
  members,
  defaultProjectId,
  defaultAssigneeId,
  defaultStatus,
  onSubmit,
}: NewTaskModalProps) {
  const [title, setTitle] = useState('')
  const descriptionRef = useRef<string | null>(null)
  const [status, setStatus] = useState<ApiStatus>(defaultStatus ?? 'TODO')
  const [priority, setPriority] = useState<ApiPriority>('MEDIUM')
  const [projectId, setProjectId] = useState(defaultProjectId ?? '')
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId ?? '')

  // Sync defaults when they change (modal may stay mounted between opens)
  useEffect(() => {
    setProjectId(defaultProjectId ?? '')
  }, [defaultProjectId])

  useEffect(() => {
    setAssigneeId(defaultAssigneeId ?? '')
  }, [defaultAssigneeId])

  useEffect(() => {
    if (isOpen) setStatus(defaultStatus ?? 'TODO')
  }, [isOpen, defaultStatus])

  const reset = () => {
    setTitle('')
    descriptionRef.current = null
    setStatus(defaultStatus ?? 'TODO')
    setPriority('MEDIUM')
    setProjectId(defaultProjectId ?? '')
    setAssigneeId(defaultAssigneeId ?? '')
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleSubmit = () => {
    const trimmedTitle = title.trim()
    const effectiveProjectId = projectId || defaultProjectId || ''
    if (!trimmedTitle || !effectiveProjectId) return

    const data = {
      title: trimmedTitle,
      description: descriptionRef.current ?? '',
      status,
      priority,
      projectId: effectiveProjectId,
      assigneeId,
    }
    reset()
    onClose()
    onSubmit(data).catch(console.error)
  }

  const canSubmit = title.trim().length > 0 && !!(projectId || defaultProjectId)

  const triggerClass = FIELD_TRIGGER_CLS

  return (
    <AnimatePresence>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title='New task'
        footer={
          <div className='flex items-center gap-3 ml-auto'>
            <Button variant='ghost' onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              Create task {submitModLabel}↵
            </Button>
          </div>
        }
      >
        {expanded => (
          <div className='space-y-4 h-full flex flex-col'>
            <input
              autoFocus
              className='w-full bg-transparent border-none p-0 text-xl font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:ring-0 outline-none'
              placeholder='Task title'
              type='text'
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => {
                if (isSubmitShortcut(e)) handleSubmit()
              }}
            />
            <div className={expanded ? 'flex-1 min-h-0 overflow-y-auto' : ''}>
              <DescriptionEditor
                value={null}
                onCommit={html => {
                  descriptionRef.current = html
                }}
                onChange={html => {
                  descriptionRef.current = html
                }}
                placeholder='Add description…'
              />
            </div>
            <div className='flex flex-wrap items-center gap-2 pt-1'>
              <StatusSelect
                value={status}
                onChange={setStatus}
                triggerClassName={triggerClass}
              />
              <ProjectSelect
                value={projectId || defaultProjectId || ''}
                onChange={setProjectId}
                projects={projects}
                triggerClassName={triggerClass}
              />
              <AssigneeSelect
                value={assigneeId || null}
                onChange={v => setAssigneeId(v ?? '')}
                members={members}
                triggerClassName={triggerClass}
              />
              <PrioritySelect
                value={priority}
                onChange={setPriority}
                triggerClassName={triggerClass}
              />
            </div>
          </div>
        )}
      </Modal>
    </AnimatePresence>
  )
}
