'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { copyLink } from '@/lib/utils/copyLink'
import { milestonesClient, type ApiMilestone } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { archiveNeedsConfirm, milestoneProgress } from './milestoneDisplay'
import { useMilestones } from '../../hooks/useMilestones'
import { useMilestoneArchive } from '../../hooks/useMilestoneArchive'
import { MilestoneRow } from './MilestoneRow'
import { MilestoneListEmpty } from './MilestoneListEmpty'
import { MilestoneListSkeleton } from './MilestoneListSkeleton'
import { MilestoneArchiveConfirm } from './MilestoneArchiveConfirm'
import { MilestoneFormDialog } from './MilestoneFormDialog'
import { ConfirmActionDialog } from '../ConfirmActionDialog'

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
  const [confirmDelete, setConfirmDelete] = useState<ApiMilestone | null>(null)

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
    <Tabs value={tab} onValueChange={value => setTab(value as Tab)}>
      <TabsList
        className='h-auto flex-wrap justify-start'
        aria-label={intl.formatMessage({ id: 'milestone.filter.label' })}
      >
        {TABS.map(t => (
          <TabsTrigger key={t.key} value={t.key} className='gap-1.5'>
            {intl.formatMessage({ id: t.labelId })}
            <span className='tabular-nums text-muted-foreground'>
              {counts[t.key]}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
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
        <MilestoneListSkeleton />
      ) : rows.length === 0 ? (
        <MilestoneListEmpty
          tab={tab}
          onCreate={() => setDialog({ mode: 'create' })}
        />
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
                onDelete={() => setConfirmDelete(m)}
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

      <ConfirmActionDialog
        open={confirmDelete !== null}
        onOpenChange={open => {
          if (!open) setConfirmDelete(null)
        }}
        title={intl.formatMessage({ id: 'milestone.delete' })}
        description={intl.formatMessage(
          { id: 'milestone.delete.confirm' },
          { name: confirmDelete?.name ?? '' }
        )}
        confirmLabel={intl.formatMessage({ id: 'common.delete' })}
        destructive
        onConfirm={() => {
          if (confirmDelete) deleteMutation.mutate(confirmDelete)
          setConfirmDelete(null)
        }}
      />

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
