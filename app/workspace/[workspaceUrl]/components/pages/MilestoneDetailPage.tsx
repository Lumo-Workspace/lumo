'use client'

import { useEffect, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { milestonesClient } from '@/lib/api-client'
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
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { DetailLayout } from '../DetailLayout'
import { MilestoneSidebar } from '../milestones/MilestoneSidebar'
import { MilestoneFormDialog } from '../milestones/MilestoneFormDialog'
import { MilestoneSprintCoverage } from '../milestones/MilestoneSprintCoverage'
import { TaskListByMilestone } from '../milestones/TaskListByMilestone'

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
      <DetailLayout
        breadcrumb={
          <span className='text-sm text-muted-foreground'>
            {intl.formatMessage({ id: 'milestone.tab.title' })}
          </span>
        }
      >
        <div className='flex-1 space-y-6 p-4 md:p-8' aria-busy='true'>
          <div className='h-8 w-1/3 animate-pulse rounded bg-muted/50' />
          <div className='h-4 w-1/4 animate-pulse rounded bg-muted/50' />
          <div className='h-40 animate-pulse rounded-lg border border-border bg-muted/50' />
        </div>
      </DetailLayout>
    )
  }

  if (!milestone) {
    return (
      <DetailLayout
        breadcrumb={
          <span className='text-sm text-muted-foreground'>
            {intl.formatMessage({ id: 'milestone.tab.title' })}
          </span>
        }
      >
        <div className='flex-1 p-4 md:p-8'>
          <p className='text-sm text-muted-foreground'>
            {intl.formatMessage({ id: 'milestone.notFound' })}
          </p>
        </div>
      </DetailLayout>
    )
  }

  const archived = !!milestone.archivedAt
  const mutating =
    archiveMutation.isPending ||
    unarchiveMutation.isPending ||
    deleteMutation.isPending

  const projectName = project?.name ?? params.projectSlug
  const projectHref = `/workspace/${params.workspaceUrl}/projects/${params.projectSlug}`

  const breadcrumb = (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href={projectHref}>{projectName}</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{milestone.name}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )

  const actions = (
    <div className='flex gap-2'>
      {!archived ? (
        <Button variant='outline' onClick={() => setEditing(true)}>
          {intl.formatMessage({ id: 'milestone.edit' })}
        </Button>
      ) : null}
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
  )

  return (
    <>
      <DetailLayout
        breadcrumb={breadcrumb}
        actions={actions}
        sidebar={
          <MilestoneSidebar
            status={milestone.status}
            startDate={milestone.startDate}
            targetDate={milestone.targetDate}
            description={milestone.description}
            archived={archived}
          />
        }
      >
        <div className='space-y-6 p-4 md:p-8 lg:overflow-y-auto'>
          <h1 className='text-2xl font-semibold text-balance'>
            {milestone.name}
          </h1>
          <MilestoneSprintCoverage coverage={milestone.sprintCoverage} />
          <TaskListByMilestone
            projectId={milestone.projectId}
            milestoneId={milestone.id}
          />
        </div>
      </DetailLayout>

      {editing ? (
        <MilestoneFormDialog
          projectId={milestone.projectId}
          milestone={milestone}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </>
  )
}
