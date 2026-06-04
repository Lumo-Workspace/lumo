'use client'

import { useEffect, useMemo } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { milestonesClient, type MilestoneUpdateInput } from '@/lib/api-client'
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
import { useMilestoneArchive } from '../../hooks/useMilestoneArchive'
import { useProjects } from '../../hooks/useProjects'
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
import { MilestoneActionsMenu } from '../milestones/MilestoneActionsMenu'
import { MilestoneDetailTabs } from '../milestones/MilestoneDetailTabs'

export function MilestoneDetailPage() {
  const intl = useIntl()
  const params = useParams<{
    workspaceUrl: string
    projectSlug: string
    milestoneId: string
  }>()
  const router = useRouter()
  const qc = useQueryClient()
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
  // Archive/unarchive flip optimistically (greying the milestone on click);
  // delete still waits on the server before navigating away.
  const { archive, unarchive } = useMilestoneArchive()
  const updateMutation = useMutation({
    mutationFn: (fields: MilestoneUpdateInput) =>
      milestonesClient.update(milestone!.id, fields),
    onSuccess: () => {
      if (!milestone) return
      qc.invalidateQueries({
        queryKey: queryKeys.milestones.detail(milestone.id),
      })
      qc.invalidateQueries({
        queryKey: queryKeys.milestones.byProject(milestone.projectId),
      })
    },
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
    archive.isPending || unarchive.isPending || deleteMutation.isPending

  const handleUpdate = (fields: MilestoneUpdateInput) =>
    updateMutation.mutate(fields)

  const projectName = project?.name ?? params.projectSlug
  const projectHref = `/workspace/${params.workspaceUrl}/projects/${params.projectSlug}`

  // Kebab sits next to the breadcrumb (not in the right-aligned actions slot),
  // matching the sprint detail page's SprintActionsMenu placement.
  const breadcrumb = (
    <div className='flex items-center gap-1.5'>
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
      <MilestoneActionsMenu
        archived={archived}
        disabled={mutating}
        onArchiveToggle={() =>
          archived ? unarchive.mutate(milestone) : archive.mutate(milestone)
        }
        onDelete={() => {
          const ok = window.confirm(
            intl.formatMessage(
              { id: 'milestone.delete.confirm' },
              { name: milestone.name }
            )
          )
          if (ok) deleteMutation.mutate()
        }}
      />
    </div>
  )

  return (
    <DetailLayout
      breadcrumb={breadcrumb}
      sidebar={
        <MilestoneSidebar
          status={milestone.status}
          startDate={milestone.startDate}
          targetDate={milestone.targetDate}
          archived={archived}
          onUpdate={handleUpdate}
        />
      }
    >
      <MilestoneDetailTabs milestone={milestone} onUpdate={handleUpdate} />
    </DetailLayout>
  )
}
