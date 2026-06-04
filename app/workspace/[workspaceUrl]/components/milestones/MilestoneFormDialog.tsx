'use client'

import { useId, useState } from 'react'
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
import { Spinner } from '@/components/ui/spinner'
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
import { MILESTONE_STATUSES } from './milestoneDisplay'

interface Props {
  projectId: string
  milestone?: ApiMilestone | undefined
  onClose: () => void
}

export function MilestoneFormDialog({ projectId, milestone, onClose }: Props) {
  const intl = useIntl()
  const qc = useQueryClient()
  const editing = !!milestone
  const fieldId = useId()

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
  const failed = createMutation.isError || updateMutation.isError
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
            <label
              htmlFor={`${fieldId}-name`}
              className='text-sm font-medium'
            >
              {intl.formatMessage({ id: 'milestone.field.name' })}
            </label>
            <Input
              id={`${fieldId}-name`}
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label
              htmlFor={`${fieldId}-description`}
              className='text-sm font-medium'
            >
              {intl.formatMessage({ id: 'milestone.field.description' })}
            </label>
            <Textarea
              id={`${fieldId}-description`}
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          {editing && (
            <div>
              <label
                htmlFor={`${fieldId}-status`}
                className='text-sm font-medium'
              >
                {intl.formatMessage({ id: 'milestone.field.status' })}
              </label>
              <Select
                value={status}
                onValueChange={v => setStatus(v as MilestoneStatus)}
              >
                <SelectTrigger id={`${fieldId}-status`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MILESTONE_STATUSES.map(s => (
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
              <label
                htmlFor={`${fieldId}-start`}
                className='text-sm font-medium'
              >
                {intl.formatMessage({ id: 'milestone.field.startDate' })}
              </label>
              <Input
                id={`${fieldId}-start`}
                type='date'
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor={`${fieldId}-target`}
                className='text-sm font-medium'
              >
                {intl.formatMessage({ id: 'milestone.field.targetDate' })}
              </label>
              <Input
                id={`${fieldId}-target`}
                type='date'
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
              />
            </div>
          </div>
          {failed && (
            <p
              role='alert'
              aria-live='polite'
              className='text-sm text-red-600 dark:text-red-400'
            >
              {intl.formatMessage({ id: 'milestone.save.error' })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant='ghost' onClick={onClose} disabled={busy}>
            {intl.formatMessage({ id: 'common.cancel' })}
          </Button>
          <Button onClick={submit} disabled={busy || name.trim().length === 0}>
            {busy && <Spinner className='mr-2 size-4' />}
            {intl.formatMessage({ id: busy ? 'common.saving' : 'common.save' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
