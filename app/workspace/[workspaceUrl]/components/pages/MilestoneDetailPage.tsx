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
import { Button } from '@/components/ui/button'
import { MilestoneFormDialog } from '../milestones/MilestoneFormDialog'
import { TaskListByMilestone } from '../milestones/TaskListByMilestone'

const STATUS_CLASS: Record<ApiMilestone['status'], string> = {
  PLANNED: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  ACTIVE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  COMPLETED:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  CANCELLED: 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-500',
}

export function MilestoneDetailPage() {
  const intl = useIntl()
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

  if (loading || !milestone) return null

  return (
    <div className='flex-1 overflow-y-auto space-y-6 p-4 md:p-8'>
      <header className='space-y-2'>
        <div className='flex items-center gap-3 flex-wrap'>
          <h1 className='text-2xl font-semibold'>{milestone.name}</h1>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[milestone.status]}`}
          >
            {intl.formatMessage({ id: `milestone.status.${milestone.status}` })}
          </span>
          <div className='ml-auto flex gap-2'>
            <Button variant='outline' onClick={() => setEditing(true)}>
              {intl.formatMessage({ id: 'milestone.edit' })}
            </Button>
            <Button
              variant='outline'
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
            <span>{milestone.startDate.slice(0, 10)} →</span>
          )}
          <span>
            {milestone.targetDate
              ? milestone.targetDate.slice(0, 10)
              : intl.formatMessage({ id: 'milestone.targetDate.none' })}
          </span>
        </div>
        {milestone.description && (
          <p className='whitespace-pre-wrap text-sm pt-2'>
            {milestone.description}
          </p>
        )}
      </header>

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
