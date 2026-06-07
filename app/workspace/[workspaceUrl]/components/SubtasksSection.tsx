'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useRouter, useParams } from 'next/navigation'
import {
  Sparkles,
  X,
  Loader2,
  Check,
  Pencil,
  Trash2,
  MoreHorizontal,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { slugify } from '@/lib/utils/slugify'
import { apiFetch } from '@/lib/api-client'
import type { TaskDetail, ApiPriority } from '../types'

interface DraftSubtask {
  id: string
  title: string
}

interface SubtasksSectionProps {
  task: TaskDetail
  onSubtasksCreated: () => void
}

export function SubtasksSection({
  task,
  onSubtasksCreated,
}: SubtasksSectionProps) {
  const intl = useIntl()
  const router = useRouter()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const [drafts, setDrafts] = useState<DraftSubtask[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  const children = task.children ?? []

  function handleChildClick(childNumber: number) {
    const identifier = `${task.teamIdentifier}-${childNumber}`
    const projectSlug = slugify(task.project.name)
    router.push(
      `/workspace/${workspaceUrl}/projects/${projectSlug}/tasks/${identifier}`
    )
  }

  function startEditing(child: { id: string; title: string }) {
    setEditingId(child.id)
    setEditingTitle(child.title)
  }

  async function saveEdit(childId: string) {
    const trimmed = editingTitle.trim()
    if (!trimmed) return
    setEditingId(null)
    try {
      await apiFetch(`/api/tasks/${childId}`, {
        method: 'PATCH',
        body: { title: trimmed },
      })
      onSubtasksCreated()
    } catch {
      setError('Failed to update subtask')
    }
  }

  async function handleDeleteChild(childId: string) {
    try {
      await apiFetch(`/api/tasks/${childId}`, { method: 'DELETE' })
      onSubtasksCreated()
    } catch {
      setError('Failed to delete subtask')
    }
  }
  const hasDrafts = drafts.length > 0

  async function handleBreakDown() {
    setError(null)
    setIsGenerating(true)
    try {
      const data = await apiFetch<{ subtasks: { title: string }[] }>(
        `/api/tasks/${task.id}/decompose`,
        {
          method: 'POST',
        }
      )
      setDrafts(
        data.subtasks.map((s: { title: string }, i: number) => ({
          id: `draft-${i}`,
          title: s.title,
        }))
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsGenerating(false)
    }
  }

  function handleDraftTitleChange(id: string, title: string) {
    setDrafts(prev => prev.map(d => (d.id === id ? { ...d, title } : d)))
  }

  function handleDeleteDraft(id: string) {
    setDrafts(prev => prev.filter(d => d.id !== id))
  }

  async function handleAddAll() {
    const validDrafts = drafts.filter(d => d.title.trim().length > 0)
    if (validDrafts.length === 0) return

    setIsCreating(true)
    setError(null)
    try {
      await apiFetch<void>(`/api/projects/${task.projectId}/tasks/batch`, {
        method: 'POST',
        body: {
          tasks: validDrafts.map(d => ({
            title: d.title.trim(),
            status: 'TODO' as const,
            priority: task.priority as ApiPriority,
            assigneeActorId: task.assigneeActorId,
            parentTaskId: task.id,
          })),
        },
      })
      setDrafts([])
      onSubtasksCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className='pt-4'>
      <p className='text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2'>
        Subtasks
      </p>

      {/* Existing children */}
      {children.length > 0 && (
        <ul className='space-y-1 mb-2'>
          {children.map(child => {
            const isDone = child.status === 'DONE'
            const isEditing = editingId === child.id
            return (
              <li
                key={child.id}
                className='group flex items-center gap-2 text-sm text-foreground py-1 rounded-sm px-1 -mx-1 hover:bg-muted transition-colors'
              >
                {isDone ? (
                  <span className='size-4 rounded-sm bg-emerald-500 text-white flex items-center justify-center shrink-0'>
                    <Check className='size-3' strokeWidth={3} />
                  </span>
                ) : (
                  <span className='size-4 rounded-sm border border-border shrink-0' />
                )}
                {isEditing ? (
                  <input
                    autoFocus
                    type='text'
                    value={editingTitle}
                    onChange={e => setEditingTitle(e.target.value)}
                    onBlur={() => saveEdit(child.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveEdit(child.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className='flex-1 text-sm px-1 py-0 rounded-sm border border-border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-ring'
                  />
                ) : (
                  <>
                    <span
                      role='button'
                      tabIndex={0}
                      onClick={() => handleChildClick(child.number)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleChildClick(child.number)
                        }
                      }}
                      className={cn(
                        'truncate cursor-pointer',
                        isDone &&
                          'line-through text-muted-foreground'
                      )}
                    >
                      {task.teamIdentifier}-{child.number} · {child.title}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          onClick={e => e.stopPropagation()}
                          className='ml-auto p-0.5 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0'
                        >
                          <MoreHorizontal className='size-3.5' />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        <DropdownMenuItem
                          onClick={e => {
                            e.stopPropagation()
                            startEditing(child)
                          }}
                        >
                          <Pencil className='size-3.5 mr-2' />
                          {intl.formatMessage({
                            id: 'subtask.edit',
                            defaultMessage: 'Edit',
                          })}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={e => {
                            e.stopPropagation()
                            handleDeleteChild(child.id)
                          }}
                          className='text-red-600 focus:text-red-600'
                        >
                          <Trash2 className='size-3.5 mr-2' />
                          {intl.formatMessage({
                            id: 'subtask.delete',
                            defaultMessage: 'Delete',
                          })}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Draft subtasks */}
      {hasDrafts && (
        <div className='space-y-1.5 mb-2'>
          {drafts.map(draft => (
            <div key={draft.id} className='flex items-center gap-1.5'>
              <input
                type='text'
                value={draft.title}
                onChange={e => handleDraftTitleChange(draft.id, e.target.value)}
                className='flex-1 text-sm px-2 py-1 rounded-sm border border-border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-ring'
              />
              <button
                onClick={() => handleDeleteDraft(draft.id)}
                aria-label={intl.formatMessage({ id: 'subtask.removeDraft' })}
                className='p-1 text-muted-foreground hover:text-foreground'
              >
                <X className='size-3.5' />
              </button>
            </div>
          ))}
          <div className='flex items-center gap-2 pt-1'>
            <Button
              size='sm'
              onClick={handleAddAll}
              disabled={
                isCreating || drafts.every(d => d.title.trim().length === 0)
              }
            >
              {isCreating ? (
                <>
                  <Loader2 className='size-3.5 animate-spin mr-1' />
                  Creating...
                </>
              ) : (
                intl.formatMessage({ id: 'subtask.addAll' })
              )}
            </Button>
            <Button
              size='sm'
              variant='ghost'
              onClick={() => setDrafts([])}
              disabled={isCreating}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && <p className='text-xs text-red-500 mb-2'>{error}</p>}

      {/* Break down button */}
      {!hasDrafts && (
        <button
          onClick={handleBreakDown}
          disabled={isGenerating}
          className='flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50'
        >
          {isGenerating ? (
            <>
              <Loader2 className='size-3.5 animate-spin' />
              AI is generating subtasks...
            </>
          ) : (
            <>
              <Sparkles className='size-3.5' />
              Break down
            </>
          )}
        </button>
      )}
    </div>
  )
}
