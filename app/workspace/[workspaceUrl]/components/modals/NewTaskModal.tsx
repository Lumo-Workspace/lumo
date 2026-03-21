'use client'

import { useState, useEffect } from 'react'
import { AnimatePresence } from 'motion/react'
import { Modal } from '../Modal'
import { ApiProject, ApiStatus, WorkspaceMemberInfo } from '../../types'
import { isSubmitShortcut, submitModLabel } from '../../utils'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface NewTaskFormData {
  title: string
  description: string
  status: ApiStatus
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
  onSubmit,
}: NewTaskModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<ApiStatus>('TODO')
  const [projectId, setProjectId] = useState(defaultProjectId ?? '')
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId ?? '')

  // Sync defaults when they change
  useEffect(() => {
    setProjectId(defaultProjectId ?? '')
  }, [defaultProjectId])

  useEffect(() => {
    setAssigneeId(defaultAssigneeId ?? '')
  }, [defaultAssigneeId])

  const reset = () => {
    setTitle('')
    setDescription('')
    setStatus('TODO')
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
      description,
      status,
      projectId: effectiveProjectId,
      assigneeId,
    }
    reset()
    onClose()
    onSubmit(data).catch(console.error)
  }

  const canSubmit = title.trim().length > 0 && !!(projectId || defaultProjectId)

  const triggerClass =
    'h-auto px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-400 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors focus:ring-1 focus:ring-zinc-300 focus:outline-none max-w-[180px]'

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
            <textarea
              className={`w-full bg-transparent border-none p-0 text-sm text-zinc-600 dark:text-zinc-400 placeholder:text-zinc-400 focus:ring-0 outline-none resize-none leading-relaxed font-sans ${expanded ? 'flex-1 min-h-0' : 'min-h-[80px]'}`}
              placeholder='Add description...'
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
            <div className='flex flex-wrap items-center gap-2 pt-1'>
              {/* Status */}
              <Select
                value={status}
                onValueChange={v => setStatus(v as ApiStatus)}
              >
                <SelectTrigger className={triggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='TODO'>Todo</SelectItem>
                  <SelectItem value='IN_PROGRESS'>In Progress</SelectItem>
                  <SelectItem value='IN_REVIEW'>In Review</SelectItem>
                  <SelectItem value='DONE'>Done</SelectItem>
                </SelectContent>
              </Select>

              {/* Project */}
              <Select
                value={projectId || defaultProjectId || ''}
                onValueChange={v => setProjectId(v)}
              >
                <SelectTrigger className={triggerClass}>
                  <SelectValue placeholder='Select project' />
                </SelectTrigger>
                <SelectContent>
                  {projects.length === 0 ? (
                    <SelectItem value='' disabled>
                      No projects
                    </SelectItem>
                  ) : (
                    projects.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>

              {/* Assignee */}
              <Select
                value={assigneeId || '__unassigned__'}
                onValueChange={v =>
                  setAssigneeId(v === '__unassigned__' ? '' : v)
                }
              >
                <SelectTrigger className={triggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='__unassigned__'>Unassigned</SelectItem>
                  {members.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </Modal>
    </AnimatePresence>
  )
}
