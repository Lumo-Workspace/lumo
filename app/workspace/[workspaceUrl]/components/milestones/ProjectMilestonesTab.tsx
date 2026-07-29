'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  milestonesClient,
  type ApiMilestone,
  type MilestoneListFilter,
} from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { useMilestones } from '../../hooks/useMilestones'
import { useMilestoneArchive } from '../../hooks/useMilestoneArchive'
import { MilestoneCard } from './MilestoneCard'
import { MilestoneFormDialog } from './MilestoneFormDialog'

interface Props {
  projectId: string
  /** Slugified project name — used to build human-readable milestone URLs. */
  projectSlug: string
}

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit'; milestone: ApiMilestone }
  | null

const FILTERS: { key: MilestoneListFilter; labelId: string }[] = [
  { key: 'active', labelId: 'milestone.filter.active' },
  { key: 'archived', labelId: 'milestone.filter.archived' },
  { key: 'all', labelId: 'milestone.filter.all' },
]

export function ProjectMilestonesTab({ projectId, projectSlug }: Props) {
  const intl = useIntl()
  const params = useParams<{ workspaceUrl: string }>()
  const qc = useQueryClient()

  const [filter, setFilter] = useState<MilestoneListFilter>('active')
  const { milestones, loading } = useMilestones(projectId, filter)
  const [dialog, setDialog] = useState<DialogState>(null)

  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: queryKeys.milestones.byProject(projectId),
    })

  const deleteMutation = useMutation({
    mutationFn: (m: ApiMilestone) => milestonesClient.delete(m.id),
    onSuccess: invalidate,
  })
  // Archive/unarchive are optimistic (see useMilestoneArchive); create/update/
  // delete stay invalidate-only, waiting on server confirmation.
  const { archive, unarchive } = useMilestoneArchive()

  const filterBar = (
    <div
      className='inline-flex rounded-md border border-border p-0.5'
      role='group'
      aria-label={intl.formatMessage({ id: 'milestone.filter.label' })}
    >
      {FILTERS.map(f => (
        <button
          key={f.key}
          type='button'
          aria-pressed={filter === f.key}
          onClick={() => setFilter(f.key)}
          className={cn(
            'rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
            filter === f.key
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {intl.formatMessage({ id: f.labelId })}
        </button>
      ))}
    </div>
  )

  return (
    <div className='space-y-4 p-4 md:p-8'>
      <div className='flex items-center justify-between gap-2'>
        {filterBar}
        <Button onClick={() => setDialog({ mode: 'create' })}>
          <Plus className='size-4' aria-hidden />
          {intl.formatMessage({ id: 'milestone.new' })}
        </Button>
      </div>

      {loading ? (
        <div className='grid gap-3' aria-busy='true'>
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className='h-[88px] animate-pulse rounded-lg border border-border bg-muted/50'
            />
          ))}
        </div>
      ) : milestones.length === 0 ? (
        <div className='py-12 text-center'>
          <p className='text-lg font-medium'>
            {intl.formatMessage({ id: 'milestone.empty.title' })}
          </p>
          {filter !== 'archived' && (
            <Button
              variant='outline'
              className='mt-4'
              onClick={() => setDialog({ mode: 'create' })}
            >
              {intl.formatMessage({ id: 'milestone.empty.cta' })}
            </Button>
          )}
        </div>
      ) : (
        <div className='grid gap-3'>
          {milestones.map(m => {
            const done = m.taskCounts?.DONE ?? 0
            const total =
              (m.taskCounts?.TODO ?? 0) +
              (m.taskCounts?.IN_PROGRESS ?? 0) +
              (m.taskCounts?.IN_REVIEW ?? 0) +
              (m.taskCounts?.DONE ?? 0)
            return (
              <MilestoneCard
                key={m.id}
                milestone={m}
                progress={{ done, total }}
                workspaceUrl={params.workspaceUrl as string}
                projectSlug={projectSlug}
                onEdit={() => setDialog({ mode: 'edit', milestone: m })}
                onArchive={mm => archive.mutate(mm)}
                onUnarchive={mm => unarchive.mutate(mm)}
                onDelete={mm => {
                  const ok = window.confirm(
                    intl.formatMessage(
                      { id: 'milestone.delete.confirm' },
                      { name: mm.name }
                    )
                  )
                  if (ok) deleteMutation.mutate(mm)
                }}
              />
            )
          })}
        </div>
      )}

      {dialog && (
        <MilestoneFormDialog
          projectId={projectId}
          milestone={dialog.mode === 'edit' ? dialog.milestone : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
