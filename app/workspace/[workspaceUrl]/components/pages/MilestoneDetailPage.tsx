'use client'

import { useEffect, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { milestonesClient, type MilestoneUpdateInput } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { MyTask } from '../../types'
import { CACHE_KEY } from '../../constants'
import { readCache, writeCache } from '../../cache'
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
import { useMembers } from '../../hooks/useMembers'
import { useProjects } from '../../hooks/useProjects'
import { DetailLayout } from '../DetailLayout'
import { MilestoneSidebar } from '../milestones/MilestoneSidebar'
import { MilestoneActionsMenu } from '../milestones/MilestoneActionsMenu'
import { MilestoneBreadcrumb } from '../milestones/MilestoneBreadcrumb'
import { MilestoneDetailBody } from '../milestones/MilestoneDetailBody'
import { milestoneState } from '@/lib/summaries/milestone-state'
import { ConfirmActionDialog } from '../ConfirmActionDialog'

interface MilestoneDetailPageProps {
  /** Open the global task drawer for a clicked task in the milestone board. */
  onOpenTask?: (task: MyTask) => void
}

export function MilestoneDetailPage({
  onOpenTask,
}: MilestoneDetailPageProps = {}) {
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
  // Members power @-mentioning people in the milestone description. useMembers
  // is a shared workspace-global query (fetched once, cached), so just read it.
  const { members } = useMembers()
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

  // Collapse / expand the right-hand milestone properties rail. The preference
  // is global across milestones (mirrors the sprint detail page) so users don't
  // re-toggle on every visit.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  useEffect(() => {
    const cached = readCache<boolean>(CACHE_KEY.milestoneSidebarCollapsed)
    if (cached !== null) setSidebarCollapsed(cached)
  }, [])
  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev
      writeCache(CACHE_KEY.milestoneSidebarCollapsed, next)
      return next
    })
  }

  if (loading) {
    return (
      <DetailLayout
        breadcrumb={
          <span className='text-body text-muted-foreground'>
            {intl.formatMessage({ id: 'milestone.tab.title' })}
          </span>
        }
      >
        <div className='flex-1 space-y-6 p-4 md:p-8' aria-busy='true'>
          <div className='h-8 w-1/3 animate-pulse rounded-sm bg-muted/50' />
          <div className='h-4 w-1/4 animate-pulse rounded-sm bg-muted/50' />
          <div className='h-40 animate-pulse rounded-lg border border-border bg-muted/50' />
        </div>
      </DetailLayout>
    )
  }

  if (!milestone) {
    return (
      <DetailLayout
        breadcrumb={
          <span className='text-body text-muted-foreground'>
            {intl.formatMessage({ id: 'milestone.tab.title' })}
          </span>
        }
      >
        <div className='flex-1 p-4 md:p-8'>
          <p className='text-body text-muted-foreground'>
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
  const projectsHref = `/workspace/${params.workspaceUrl}/projects`
  const projectHref = `/workspace/${params.workspaceUrl}/projects/${params.projectSlug}`

  // Kebab sits next to the breadcrumb (not in the right-aligned actions slot),
  // matching the sprint detail page's SprintActionsMenu placement.
  const breadcrumb = (
    <div className='flex items-center gap-1.5'>
      <MilestoneBreadcrumb
        projectsHref={projectsHref}
        projectHref={projectHref}
        projectName={projectName}
        milestoneName={milestone.name}
      />
      <MilestoneActionsMenu
        archived={archived}
        disabled={mutating}
        onArchiveToggle={() =>
          archived ? unarchive.mutate(milestone) : archive.mutate(milestone)
        }
        onDelete={() => setConfirmDeleteOpen(true)}
      />
      <ConfirmActionDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={intl.formatMessage({ id: 'milestone.delete' })}
        description={intl.formatMessage(
          { id: 'milestone.delete.confirm' },
          { name: milestone.name }
        )}
        confirmLabel={intl.formatMessage({ id: 'common.delete' })}
        destructive
        onConfirm={() => {
          setConfirmDeleteOpen(false)
          deleteMutation.mutate()
        }}
      />
    </div>
  )

  // LUM-727: the tasks region lost its toolbar, so the properties-rail toggle
  // moves up into the breadcrumb bar — the rail keeps its only control.
  const sidebarLabel = intl.formatMessage({
    id: sidebarCollapsed
      ? 'milestone.detail.expandSidebar'
      : 'milestone.detail.collapseSidebar',
  })
  const actions = (
    <button
      type='button'
      onClick={toggleSidebar}
      title={sidebarLabel}
      aria-label={sidebarLabel}
      className='flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
    >
      {sidebarCollapsed ? (
        <PanelRightOpen className='size-4' />
      ) : (
        <PanelRightClose className='size-4' />
      )}
    </button>
  )

  return (
    <DetailLayout
      breadcrumb={breadcrumb}
      actions={actions}
      sidebar={
        <div className='flex h-full flex-col gap-4 overflow-y-auto border-l border-border bg-muted/30 px-5 py-6'>
          <MilestoneSidebar
            state={milestoneState(milestone)}
            startDate={milestone.startDate}
            targetDate={milestone.targetDate}
            archived={archived}
            datesMissing={milestone.staleness?.datesMissing ?? false}
            onUpdate={handleUpdate}
          />
        </div>
      }
      sidebarCollapsed={sidebarCollapsed}
      flushSidebar
    >
      <MilestoneDetailBody
        milestone={milestone}
        onUpdate={handleUpdate}
        members={members}
        onOpenTask={onOpenTask ?? (() => {})}
      />
    </DetailLayout>
  )
}
