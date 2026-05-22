'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { milestonesClient, type ApiMilestone } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { useMilestones } from '../../hooks/useMilestones'
import { MilestoneCard } from './MilestoneCard'
import { MilestoneFormDialog } from './MilestoneFormDialog'

interface Props {
  projectId: string
}

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit'; milestone: ApiMilestone }
  | null

export function ProjectMilestonesTab({ projectId }: Props) {
  const intl = useIntl()
  const params = useParams<{ workspaceUrl: string }>()
  const qc = useQueryClient()

  const { milestones, loading } = useMilestones(projectId)
  const [dialog, setDialog] = useState<DialogState>(null)

  const deleteMutation = useMutation({
    mutationFn: (m: ApiMilestone) => milestonesClient.delete(m.id),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: queryKeys.milestones.byProject(projectId),
      }),
  })

  if (loading) return null

  return (
    <div className='space-y-4 p-4 md:p-8'>
      <div className='flex justify-end'>
        <Button onClick={() => setDialog({ mode: 'create' })}>
          {intl.formatMessage({ id: 'milestone.new' })}
        </Button>
      </div>

      {milestones.length === 0 ? (
        <div className='py-12 text-center'>
          <p className='text-lg font-medium'>
            {intl.formatMessage({ id: 'milestone.empty.title' })}
          </p>
          <Button
            variant='outline'
            className='mt-4'
            onClick={() => setDialog({ mode: 'create' })}
          >
            {intl.formatMessage({ id: 'milestone.empty.cta' })}
          </Button>
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
                projectId={projectId}
                onEdit={() => setDialog({ mode: 'edit', milestone: m })}
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
