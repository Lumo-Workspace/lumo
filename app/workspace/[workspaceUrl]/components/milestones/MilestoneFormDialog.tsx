'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { milestonesClient, type ApiMilestone } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { MilestoneStatus } from '@prisma/client'

interface Props {
  projectId: string
  milestone?: ApiMilestone | undefined
  onClose: () => void
}

const STATUSES: MilestoneStatus[] = [
  'PLANNED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
]

export function MilestoneFormDialog({ projectId, milestone, onClose }: Props) {
  const intl = useIntl()
  const qc = useQueryClient()
  const editing = !!milestone

  const [name, setName] = useState(milestone?.name ?? '')
  const [description, setDescription] = useState(milestone?.description ?? '')
  const [status, setStatus] = useState<MilestoneStatus>(
    milestone?.status ?? 'PLANNED'
  )
  const [startDate, setStartDate] = useState(
    milestone?.startDate?.slice(0, 10) ?? ''
  )
  const [targetDate, setTargetDate] = useState(
    milestone?.targetDate?.slice(0, 10) ?? ''
  )

  const createMutation = useMutation({
    mutationFn: () =>
      milestonesClient.create(projectId, {
        name,
        description: description || null,
        startDate: startDate || null,
        targetDate: targetDate || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.milestones.byProject(projectId),
      })
      onClose()
    },
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      milestonesClient.update(milestone!.id, {
        name,
        description: description || null,
        status,
        startDate: startDate || null,
        targetDate: targetDate || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.milestones.byProject(projectId),
      })
      qc.invalidateQueries({
        queryKey: queryKeys.milestones.detail(milestone!.id),
      })
      onClose()
    },
  })

  const busy = createMutation.isPending || updateMutation.isPending
  const submit = () =>
    editing ? updateMutation.mutate() : createMutation.mutate()

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({
              id: editing ? 'milestone.edit' : 'milestone.new',
            })}
          </DialogTitle>
        </DialogHeader>
        <div className='space-y-3'>
          <div>
            <label className='text-sm font-medium'>
              {intl.formatMessage({ id: 'milestone.field.name' })}
            </label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className='text-sm font-medium'>
              {intl.formatMessage({ id: 'milestone.field.description' })}
            </label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          {editing && (
            <div>
              <label className='text-sm font-medium'>
                {intl.formatMessage({ id: 'milestone.field.status' })}
              </label>
              <Select
                value={status}
                onValueChange={v => setStatus(v as MilestoneStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => (
                    <SelectItem key={s} value={s}>
                      {intl.formatMessage({ id: `milestone.status.${s}` })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='text-sm font-medium'>
                {intl.formatMessage({ id: 'milestone.field.startDate' })}
              </label>
              <Input
                type='date'
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className='text-sm font-medium'>
                {intl.formatMessage({ id: 'milestone.field.targetDate' })}
              </label>
              <Input
                type='date'
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant='ghost' onClick={onClose} disabled={busy}>
            {intl.formatMessage({ id: 'common.cancel' })}
          </Button>
          <Button onClick={submit} disabled={busy || name.trim().length === 0}>
            {intl.formatMessage({ id: 'common.save' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
