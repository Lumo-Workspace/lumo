'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { sprintsClient } from '@/lib/api-client'
import type { Sprint } from '@prisma/client'
import {
  deriveSprintState,
  type DerivedSprintState,
} from '@/lib/services/sprint-date'

interface SprintProgress {
  done: number
  total: number
}

interface SprintSidebarProps {
  sprint: Sprint
  progress: SprintProgress
  onRefresh: () => void
}

const STATE_BADGE: Record<DerivedSprintState, string> = {
  UPCOMING: 'bg-muted text-muted-foreground',
  CURRENT: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  COMPLETED:
    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

const STATE_I18N_KEY: Record<DerivedSprintState, string> = {
  UPCOMING: 'sprints.state.upcoming',
  CURRENT: 'sprints.state.current',
  COMPLETED: 'sprints.state.completed',
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString()
}

export function SprintSidebar({ sprint, progress }: SprintSidebarProps) {
  const intl = useIntl()
  const router = useRouter()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const state = deriveSprintState(sprint)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  async function handleDelete() {
    setDeleting(true)
    try {
      await sprintsClient.remove(sprint.id)
      toast.success(intl.formatMessage({ id: 'sprints.detail.deleted' }))
      router.push(`/workspace/${workspaceUrl}/sprints`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
      setDeleting(false)
    }
  }

  return (
    <>
      <aside className='flex flex-col gap-4 rounded-lg border bg-muted/10 p-4 overflow-y-auto'>
        {/* Name + derived state badge */}
        <div>
          <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5'>
            {sprint.name}
          </p>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATE_BADGE[state]}`}
          >
            {intl.formatMessage({ id: STATE_I18N_KEY[state] })}
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

        {/* Destructive action lives at the bottom so it doesn't compete with
            the information above. */}
        <div className='mt-auto'>
          <Button
            size='sm'
            variant='outline'
            className='w-full text-destructive hover:text-destructive'
            disabled={deleting}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className='size-4 mr-2' />
            {intl.formatMessage({ id: 'sprints.detail.deleteSprint' })}
          </Button>
        </div>
      </aside>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage(
                { id: 'sprints.detail.deleteConfirmTitle' },
                { name: sprint.name }
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: 'sprints.detail.deleteConfirmBody' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {intl.formatMessage({ id: 'sprints.detail.deleteCancel' })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={handleDelete}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              {intl.formatMessage({ id: 'sprints.detail.deleteConfirm' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
