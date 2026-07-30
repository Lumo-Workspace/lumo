'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { copyLink } from '@/lib/utils/copyLink'
import { milestonesClient, type ApiMilestone } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { archiveNeedsConfirm, milestoneProgress } from './milestoneDisplay'
import { useMilestones } from '../../hooks/useMilestones'
import { useMilestoneArchive } from '../../hooks/useMilestoneArchive'
import { MilestoneRow } from './MilestoneRow'
import { MilestoneArchiveConfirm } from './MilestoneArchiveConfirm'
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

/** Archive-state view. Not the server's `MilestoneListFilter` — see below. */
type Tab = 'active' | 'archived' | 'all'

const TABS: { key: Tab; labelId: string }[] = [
  { key: 'active', labelId: 'milestone.filter.active' },
  { key: 'archived', labelId: 'milestone.filter.archived' },
  { key: 'all', labelId: 'milestone.filter.all' },
]

export function ProjectMilestonesTab({ projectId, projectSlug }: Props) {
  const intl = useIntl()
  const params = useParams<{ workspaceUrl: string }>()
  const qc = useQueryClient()

  const [tab, setTab] = useState<Tab>('active')
  // One `all` fetch backs every tab: the counts on the chips and the rows below
  // them then always agree, and switching tabs costs nothing. Splitting them
  // across three server-filtered queries made the counts arrive per-tab, so a
  // chip could claim a number the list had never loaded.
  const { milestones, loading } = useMilestones(projectId, 'all')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [confirmArchive, setConfirmArchive] = useState<ApiMilestone | null>(
    null
  )

  const { rows, counts } = useMemo(() => {
    const active = milestones.filter(m => !m.archivedAt)
    const archived = milestones.filter(m => !!m.archivedAt)
    return {
      rows:
        tab === 'active' ? active : tab === 'archived' ? archived : milestones,
      counts: {
        active: active.length,
        archived: archived.length,
        all: milestones.length,
      },
    }
  }, [milestones, tab])

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

  const onArchiveToggle = (m: ApiMilestone) => {
    if (archiveNeedsConfirm(m)) setConfirmArchive(m)
    else if (m.archivedAt) unarchive.mutate(m)
    else archive.mutate(m)
  }

  const filterBar = (
    <div
      className='flex flex-wrap items-center gap-2'
      role='group'
      aria-label={intl.formatMessage({ id: 'milestone.filter.label' })}
    >
      {TABS.map(t => (
        <button
          key={t.key}
          type='button'
          aria-pressed={tab === t.key}
          onClick={() => setTab(t.key)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-caption transition-colors',
            tab === t.key
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-muted-foreground hover:text-foreground'
          )}
        >
          {intl.formatMessage({ id: t.labelId })}
          <span className='tabular-nums opacity-70'>{counts[t.key]}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div className='space-y-3 p-4 md:p-8'>
      <div className='flex items-center justify-between gap-2'>
        {filterBar}
        <Button onClick={() => setDialog({ mode: 'create' })}>
          <Plus className='size-4' aria-hidden />
          {intl.formatMessage({ id: 'milestone.new' })}
        </Button>
      </div>

      {loading ? (
        <div
          className='divide-y divide-border overflow-hidden rounded-lg border border-border'
          aria-busy='true'
        >
          {[0, 1, 2, 3].map(i => (
            <div key={i} className='h-[41px] animate-pulse bg-muted/50' />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className='py-12 text-center'>
          <p className='text-lg font-medium'>
            {intl.formatMessage({ id: 'milestone.empty.title' })}
          </p>
          {tab !== 'archived' && (
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
        <div className='divide-y divide-border overflow-hidden rounded-lg border border-border'>
          {rows.map(m => {
            const href = `/workspace/${params.workspaceUrl}/projects/${projectSlug}/milestones/${m.slug}`
            return (
              <MilestoneRow
                key={m.id}
                milestone={m}
                progress={milestoneProgress(m)}
                href={href}
                onEdit={() => setDialog({ mode: 'edit', milestone: m })}
                onArchiveToggle={() => onArchiveToggle(m)}
                onCopyLink={() => copyLink(`${window.location.origin}${href}`)}
                onDelete={() => {
                  const ok = window.confirm(
                    intl.formatMessage(
                      { id: 'milestone.delete.confirm' },
                      { name: m.name }
                    )
                  )
                  if (ok) deleteMutation.mutate(m)
                }}
              />
            )
          })}
        </div>
      )}

      {confirmArchive && (
        <MilestoneArchiveConfirm
          name={confirmArchive.name}
          remaining={
            milestoneProgress(confirmArchive).total -
            milestoneProgress(confirmArchive).done
          }
          onCancel={() => setConfirmArchive(null)}
          onConfirm={() => {
            archive.mutate(confirmArchive)
            setConfirmArchive(null)
          }}
        />
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
