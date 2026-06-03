'use client'

import { useEffect, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { milestonesClient, type ApiMilestone } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import {
  findProjectForMilestoneSegment,
  getCanonicalMilestonePath,
  MILESTONE_CUID_RE,
} from '../../utils/milestonePath'
import {
  useMilestone,
  useMilestoneByProjectAndSlug,
} from '../../hooks/useMilestone'
import { useProjects } from '../../hooks/useProjects'
import { useFormatDate } from '../../hooks/useFormatDate'
import { Button } from '@/components/ui/button'
import { MilestoneFormDialog } from '../milestones/MilestoneFormDialog'
import { MilestoneSprintCoverage } from '../milestones/MilestoneSprintCoverage'
import { TaskListByMilestone } from '../milestones/TaskListByMilestone'

const STATUS_CLASS: Record<ApiMilestone['status'], string> = {
  PLANNED: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  ACTIVE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  COMPLETED:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  CANCELLED: 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-500',
}

// Calendar dates stored at UTC midnight — format in UTC so the shown day
// matches what was entered regardless of the viewer's time zone.
const DATE_OPTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
}

export function MilestoneDetailPage() {
  const intl = useIntl()
  const { fmtDate } = useFormatDate()
  const params = useParams<{
    workspaceUrl: string
    projectSlug: string
    milestoneId: string
  }>()
  const router = useRouter()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)

  // The URL segment may be either a legacy cuid or the new slug. We branch
  // here so the right endpoint resolves the milestone; both hooks are always
  // called (one with disabled inputs) to keep the hook order stable.
  const segment = params.milestoneId
  const isCuid = MILESTONE_CUID_RE.test(segment ?? '')
  const { projects } = useProjects()
  const project = useMemo(
    () => findProjectForMilestoneSegment(projects, params.projectSlug),
    [projects, params.projectSlug]
  )
  const byIdQuery = useMilestone(isCuid ? segment : null)
  const bySlugQuery = useMilestoneByProjectAndSlug(
    !isCuid ? (project?.id ?? null) : null,
    !isCuid ? segment : null
  )
  const milestone = byIdQuery.milestone ?? bySlugQuery.milestone
  const loading =
    (isCuid ? byIdQuery.loading : bySlugQuery.loading || !project) && !milestone

  // Canonicalize cuid URLs to their slug form once the milestone loads, so
  // legacy cuid URLs (bookmarks, pasted, hand-built from CLI ids, or surfaced
  // by stale frontend bundles) settle on the human-readable URL.
  useEffect(() => {
    const canonical = getCanonicalMilestonePath(
      params,
      milestone,
      project?.name
    )
    if (canonical) router.replace(canonical)
  }, [params, milestone, project?.name, router])

  const invalidate = () => {
    if (milestone) {
      qc.invalidateQueries({
        queryKey: queryKeys.milestones.byProject(milestone.projectId),
      })
      qc.invalidateQueries({
        queryKey: queryKeys.milestones.detail(milestone.id),
      })
    }
  }

  const deleteMutation = useMutation({
    mutationFn: () => milestonesClient.delete(milestone!.id),
    onSuccess: () => {
      if (milestone) {
        qc.invalidateQueries({
          queryKey: queryKeys.milestones.byProject(milestone.projectId),
        })
      }
      router.push(
        `/workspace/${params.workspaceUrl}/projects/${params.projectSlug}`
      )
    },
  })
  const archiveMutation = useMutation({
    mutationFn: () => milestonesClient.archive(milestone!.id),
    onSuccess: invalidate,
  })
  const unarchiveMutation = useMutation({
    mutationFn: () => milestonesClient.unarchive(milestone!.id),
    onSuccess: invalidate,
  })

  if (loading) {
    return (
      <div className='flex-1 space-y-6 p-4 md:p-8' aria-busy='true'>
        <div className='h-8 w-1/3 animate-pulse rounded bg-muted/50' />
        <div className='h-4 w-1/4 animate-pulse rounded bg-muted/50' />
        <div className='h-40 animate-pulse rounded-lg border border-border bg-muted/50' />
      </div>
    )
  }

  if (!milestone) {
    return (
      <div className='flex-1 p-4 md:p-8'>
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.notFound' })}
        </p>
      </div>
    )
  }

  const archived = !!milestone.archivedAt
  const mutating =
    archiveMutation.isPending ||
    unarchiveMutation.isPending ||
    deleteMutation.isPending

  return (
    <div className='flex-1 overflow-y-auto space-y-6 p-4 md:p-8'>
      <header className='space-y-2'>
        <div className='flex items-center gap-3 flex-wrap'>
          <h1 className='text-2xl font-semibold text-balance'>
            {milestone.name}
          </h1>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[milestone.status]}`}
          >
            {intl.formatMessage({ id: `milestone.status.${milestone.status}` })}
          </span>
          {archived && (
            <span className='rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>
              {intl.formatMessage({ id: 'milestone.archived' })}
            </span>
          )}
          <div className='ml-auto flex gap-2'>
            {!archived && (
              <Button variant='outline' onClick={() => setEditing(true)}>
                {intl.formatMessage({ id: 'milestone.edit' })}
              </Button>
            )}
            {archived ? (
              <Button
                variant='outline'
                disabled={mutating}
                onClick={() => unarchiveMutation.mutate()}
              >
                {intl.formatMessage({ id: 'milestone.unarchive' })}
              </Button>
            ) : (
              <Button
                variant='outline'
                disabled={mutating}
                onClick={() => archiveMutation.mutate()}
              >
                {intl.formatMessage({ id: 'milestone.archive' })}
              </Button>
            )}
            <Button
              variant='outline'
              disabled={mutating}
              className='text-red-600 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400'
              onClick={() => {
                const ok = window.confirm(
                  intl.formatMessage(
                    { id: 'milestone.delete.confirm' },
                    { name: milestone.name }
                  )
                )
                if (ok) deleteMutation.mutate()
              }}
            >
              {intl.formatMessage({ id: 'milestone.delete' })}
            </Button>
          </div>
        </div>
        <div className='text-sm text-zinc-500 dark:text-zinc-400 space-x-2'>
          {milestone.startDate && (
            <span>{fmtDate(milestone.startDate, DATE_OPTS)} →</span>
          )}
          <span>
            {milestone.targetDate
              ? fmtDate(milestone.targetDate, DATE_OPTS)
              : intl.formatMessage({ id: 'milestone.targetDate.none' })}
          </span>
        </div>
        {milestone.description && (
          <p className='whitespace-pre-wrap text-sm pt-2'>
            {milestone.description}
          </p>
        )}
      </header>

      <MilestoneSprintCoverage coverage={milestone.sprintCoverage} />

      <TaskListByMilestone
        projectId={milestone.projectId}
        milestoneId={milestone.id}
      />

      {editing && (
        <MilestoneFormDialog
          projectId={milestone.projectId}
          milestone={milestone}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}
