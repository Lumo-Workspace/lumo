'use client'

import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { sprintsClient, tasksClient } from '@/lib/api-client'
import { ApiClientError } from '@/lib/api-client/base'

type Decision = 'moveToNext' | 'backToBacklog'

interface Task {
  id: string
  title: string
  status: string
}

interface CloseSprintDialogProps {
  sprintId: string
  onClose: () => void
  onClosed: () => void
}

function DecisionToggle({
  value,
  onChange,
}: {
  value: Decision | undefined
  onChange: (v: Decision) => void
}) {
  const intl = useIntl()
  return (
    <div className='flex gap-1 text-caption'>
      <button
        type='button'
        onClick={() => onChange('moveToNext')}
        className={`rounded-sm border px-2 py-0.5 ${
          value === 'moveToNext'
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border hover:bg-muted'
        }`}
      >
        {intl.formatMessage({ id: 'sprints.close.moveToNext' })}
      </button>
      <button
        type='button'
        onClick={() => onChange('backToBacklog')}
        className={`rounded-sm border px-2 py-0.5 ${
          value === 'backToBacklog'
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border hover:bg-muted'
        }`}
      >
        {intl.formatMessage({ id: 'sprints.close.toBacklog' })}
      </button>
    </div>
  )
}

export function CloseSprintDialog({
  sprintId,
  onClose,
  onClosed,
}: CloseSprintDialogProps) {
  const intl = useIntl()
  const [tasks, setTasks] = useState<Task[]>([])
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  async function loadTasks() {
    setLoading(true)
    try {
      const result = await tasksClient.listBySprint<{ tasks: Task[] }>(sprintId)
      const unfinished = result.tasks.filter(t => t.status !== 'DONE')
      setTasks(unfinished)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTasks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprintId])

  function setDecision(taskId: string, decision: Decision) {
    setDecisions(prev => ({ ...prev, [taskId]: decision }))
  }

  function setAll(decision: Decision) {
    const next: Record<string, Decision> = {}
    for (const t of tasks) next[t.id] = decision
    setDecisions(next)
  }

  const allDecided =
    tasks.length === 0 || tasks.every(t => decisions[t.id] !== undefined)

  async function handleSubmit() {
    setSubmitting(true)
    try {
      await sprintsClient.close(sprintId, decisions)
      onClosed()
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        toast.error(
          intl.formatMessage({ id: 'sprints.close.membershipChanged' })
        )
        setDecisions({})
        await loadTasks()
      } else {
        toast.error(
          err instanceof Error ? err.message : 'Failed to close sprint'
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose()
      }}
    >
      <DialogContent className='max-w-lg overflow-hidden'>
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: 'sprints.close.title' })}
          </DialogTitle>
        </DialogHeader>

        <div className='flex flex-col gap-4 min-w-0 max-w-full'>
          {loading ? (
            <p className='text-body text-muted-foreground'>
              {intl.formatMessage({ id: 'sprints.detail.loading' })}
            </p>
          ) : tasks.length === 0 ? (
            <p className='text-body text-muted-foreground'>
              {intl.formatMessage({ id: 'sprints.close.allDone' })}
            </p>
          ) : (
            <>
              <p className='text-body text-muted-foreground'>
                {intl.formatMessage(
                  { id: 'sprints.close.unfinishedCount' },
                  { count: tasks.length }
                )}
              </p>

              {/* Bulk actions */}
              <div className='flex gap-2'>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  onClick={() => setAll('moveToNext')}
                >
                  {intl.formatMessage({ id: 'sprints.close.moveAllNext' })}
                </Button>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  onClick={() => setAll('backToBacklog')}
                >
                  {intl.formatMessage({ id: 'sprints.close.allToBacklog' })}
                </Button>
              </div>

              {/* Per-task decisions */}
              <div className='flex flex-col gap-2 max-h-64 overflow-y-auto w-full min-w-0'>
                {tasks.map(task => (
                  <div
                    key={task.id}
                    className='flex w-full items-center justify-between gap-2 rounded-sm border p-2 min-w-0'
                  >
                    <span className='text-body truncate flex-1 min-w-0'>
                      {task.title}
                    </span>
                    <div className='shrink-0'>
                      <DecisionToggle
                        value={decisions[task.id]}
                        onChange={v => setDecision(task.id, v)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <p className='text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'sprints.close.irreversible' })}
          </p>
        </div>

        <DialogFooter>
          <Button type='button' variant='outline' onClick={onClose}>
            {intl.formatMessage({ id: 'sprints.close.cancel' })}
          </Button>
          <Button
            type='button'
            disabled={!allDecided || submitting || loading}
            onClick={handleSubmit}
          >
            {intl.formatMessage({ id: 'sprints.close.closeSprint' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
