'use client'

import { useState } from 'react'
import { Sparkles, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '../utils'
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
  const [drafts, setDrafts] = useState<DraftSubtask[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const children = task.children ?? []
  const hasDrafts = drafts.length > 0

  async function handleBreakDown() {
    setError(null)
    setIsGenerating(true)
    try {
      const res = await apiFetch(`/api/tasks/${task.id}/decompose`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to generate subtasks')
      }
      const data = await res.json()
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
      const res = await apiFetch(
        `/api/projects/${task.projectId}/tasks/batch`,
        {
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
        }
      )
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to create subtasks')
      }
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
      <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2'>
        Subtasks
      </p>

      {/* Existing children */}
      {children.length > 0 && (
        <ul className='space-y-1 mb-2'>
          {children.map(child => (
            <li
              key={child.id}
              className='flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 py-1'
            >
              <span className='size-4 rounded border border-zinc-300 dark:border-zinc-600 shrink-0' />
              <span className='truncate'>{child.title}</span>
              <span className='text-xs text-zinc-400 dark:text-zinc-500 shrink-0'>
                #{child.number}
              </span>
            </li>
          ))}
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
                className='flex-1 text-sm px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400'
              />
              <button
                onClick={() => handleDeleteDraft(draft.id)}
                className='p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
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
                'Add all'
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
          className='flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors disabled:opacity-50'
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
