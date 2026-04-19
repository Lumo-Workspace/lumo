'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { sprintsClient } from '@/lib/api-client'
import type { Sprint } from '@prisma/client'
import { CloseSprintDialog } from './CloseSprintDialog'

interface SprintProgress {
  done: number
  total: number
}

interface SprintSidebarProps {
  sprint: Sprint
  progress: SprintProgress
  onRefresh: () => void
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  ACTIVE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  CLOSED:
    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

const STATUS_I18N_KEY: Record<string, string> = {
  DRAFT: 'sprints.status.draft',
  ACTIVE: 'sprints.status.active',
  CLOSED: 'sprints.status.closed',
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString()
}

export function SprintSidebar({
  sprint,
  progress,
  onRefresh,
}: SprintSidebarProps) {
  const intl = useIntl()
  const [busy, setBusy] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  async function handleStart() {
    setBusy(true)
    try {
      await sprintsClient.start(sprint.id)
      onRefresh()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to start sprint')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (
      !confirm(intl.formatMessage({ id: 'sprints.detail.deleteDraft' }) + '?')
    )
      return
    setBusy(true)
    try {
      await sprintsClient.remove(sprint.id)
      window.location.href = '../'
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to delete sprint')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <aside className='flex flex-col gap-4 rounded-lg border bg-muted/10 p-4 overflow-y-auto'>
        {/* Name */}
        <div>
          <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5'>
            {sprint.name}
          </p>
          {/* Status badge */}
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[sprint.status] ?? 'bg-muted text-muted-foreground'}`}
          >
            {intl.formatMessage({
              id: STATUS_I18N_KEY[sprint.status] ?? 'sprints.status.draft',
            })}
          </span>
        </div>

        {/* Dates */}
        <div className='flex flex-col gap-1 text-sm'>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>
              {intl.formatMessage({ id: 'sprints.detail.dateStart' })}
            </span>
            <span>{formatDate(sprint.startDate)}</span>
          </div>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>
              {intl.formatMessage({ id: 'sprints.detail.dateEnd' })}
            </span>
            <span>{formatDate(sprint.endDate)}</span>
          </div>
          {sprint.startedAt && (
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>
                {intl.formatMessage({ id: 'sprints.detail.dateStarted' })}
              </span>
              <span>{formatDate(sprint.startedAt)}</span>
            </div>
          )}
          {sprint.closedAt && (
            <div className='flex justify-between'>
              <span className='text-muted-foreground'>
                {intl.formatMessage({ id: 'sprints.detail.dateClosed' })}
              </span>
              <span>{formatDate(sprint.closedAt)}</span>
            </div>
          )}
        </div>

        {/* Progress */}
        <div className='flex flex-col gap-1.5'>
          <div className='flex justify-between text-xs text-muted-foreground'>
            <span>{intl.formatMessage({ id: 'sprints.detail.progress' })}</span>
            <span>
              {progress.done} / {progress.total}
            </span>
          </div>
          <Progress value={pct} className='h-2' />
          <p className='text-xs text-muted-foreground text-right'>{pct}%</p>
        </div>

        {/* Actions per status */}
        <div className='flex flex-col gap-2 mt-auto'>
          {sprint.status === 'DRAFT' && (
            <>
              <Button size='sm' disabled={busy} onClick={handleStart}>
                {intl.formatMessage({ id: 'sprints.detail.startSprint' })}
              </Button>
              {/* TODO(P3.6): wire PlanBacklogPanel for full plan mode */}
              <Button size='sm' variant='outline' asChild>
                <a href='?plan=1'>
                  {intl.formatMessage({ id: 'sprints.detail.planTasks' })}
                </a>
              </Button>
              <Button
                size='sm'
                variant='destructive'
                disabled={busy}
                onClick={handleDelete}
              >
                {intl.formatMessage({ id: 'sprints.detail.deleteDraft' })}
              </Button>
            </>
          )}

          {sprint.status === 'ACTIVE' && (
            <>
              <Button size='sm' variant='outline' disabled>
                {intl.formatMessage({ id: 'sprints.detail.addTask' })}
              </Button>
              <Button
                size='sm'
                variant='outline'
                onClick={() => setCloseOpen(true)}
              >
                {intl.formatMessage({ id: 'sprints.detail.closeSprint' })}
              </Button>
            </>
          )}

          {sprint.status === 'CLOSED' && (
            <Button size='sm' variant='outline' asChild>
              {/* TODO(P4.2): wire retro page */}
              <a href='./retro'>
                {intl.formatMessage({ id: 'sprints.detail.viewRetro' })}
              </a>
            </Button>
          )}
        </div>
      </aside>

      {closeOpen && (
        <CloseSprintDialog
          sprintId={sprint.id}
          onClose={() => setCloseOpen(false)}
          onClosed={() => {
            setCloseOpen(false)
            onRefresh()
          }}
        />
      )}
    </>
  )
}
