'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePickerField, startOfDay } from './DatePickerField'

export interface CreateSprintInput {
  name?: string
  startDate: Date
  endDate: Date
}

/**
 * Create-sprint dialog. Extracted from the old SprintCards so both the
 * redesigned board header and the empty-state CTA can open the same form
 * without duplicating the date-range logic.
 */
export function CreateSprintDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSubmit: (input: CreateSprintInput) => void
}) {
  const intl = useIntl()
  const [name, setName] = useState('')
  // Lazy initializers so the clock is read once on mount, not on every render
  // (reading `new Date()` during render violates purity). 14 days inclusive of
  // both endpoints → end is start + 13.
  const [start, setStart] = useState<Date>(() => startOfDay(new Date()))
  const [end, setEnd] = useState<Date>(() =>
    startOfDay(
      new Date(startOfDay(new Date()).getTime() + 13 * 24 * 60 * 60 * 1000)
    )
  )

  const valid = end > start

  function submit() {
    if (!valid) return
    onSubmit({
      ...(name.trim() ? { name: name.trim() } : {}),
      startDate: start,
      endDate: end,
    })
    // Close immediately — parent owns the optimistic update + toast.
    onOpenChange(false)
    setName('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: 'sprints.create.title' })}
          </DialogTitle>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label htmlFor='sprint-name'>
              {intl.formatMessage({ id: 'sprints.create.name' })}
            </Label>
            <Input
              id='sprint-name'
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={intl.formatMessage({
                id: 'sprints.create.namePlaceholder',
              })}
              maxLength={120}
            />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-1'>
              <Label htmlFor='sprint-start'>
                {intl.formatMessage({ id: 'sprints.create.startDate' })}
              </Label>
              <DatePickerField
                id='sprint-start'
                value={start}
                onChange={setStart}
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='sprint-end'>
                {intl.formatMessage({ id: 'sprints.create.endDate' })}
              </Label>
              <DatePickerField id='sprint-end' value={end} onChange={setEnd} />
            </div>
          </div>
          {!valid && (
            <p className='text-caption text-muted-foreground'>
              {intl.formatMessage({ id: 'sprints.create.invalidRange' })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            {intl.formatMessage({ id: 'sprints.create.cancel' })}
          </Button>
          <Button onClick={submit} disabled={!valid}>
            {intl.formatMessage({ id: 'sprints.create.submit' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
