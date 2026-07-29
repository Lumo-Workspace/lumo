'use client'

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { isSubmitShortcut, submitModLabel } from '../../utils'
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
  const nameRef = useRef<HTMLInputElement>(null)

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
  const canSubmit = !busy && name.trim().length > 0

  const submit = () => {
    if (!canSubmit) return
    if (editing) updateMutation.mutate()
    else createMutation.mutate()
  }

  // The shortcut is advertised on the CTA itself. Enter alone stays a newline —
  // the description is a paragraph, not a single-line control.
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isSubmitShortcut(e)) {
      e.preventDefault()
      submit()
    }
  }

  const label = (id: string) => intl.formatMessage({ id })

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent
        // `max-w-[620px]` is deliberately unprefixed: a `sm:`-variant width
        // does not out-cascade the base `max-w-lg` DialogContent ships with,
        // and only an unprefixed class in the same group gets it merged away.
        className='flex max-h-[85vh] max-w-[620px] flex-col gap-0 px-10 pb-6 pt-8'
        onKeyDown={handleKeyDown}
        // Radix focuses the first focusable element on open, and the browser
        // selects a text input's whole value when focus lands that way — in
        // edit mode the first keystroke would wipe the existing name. Focus it
        // ourselves with the caret collapsed at the end instead. (jsdom does
        // not reproduce the selection, so this is not test-guarded — see
        // LUM-711.)
        onOpenAutoFocus={event => {
          const el = nameRef.current
          if (!el) return
          event.preventDefault()
          el.focus()
          el.setSelectionRange(el.value.length, el.value.length)
        }}
      >
        <DialogHeader className='mb-5'>
          <DialogTitle className='text-xl font-bold'>
            {label(editing ? 'milestone.edit' : 'milestone.new')}
          </DialogTitle>
        </DialogHeader>

        {/* The inset padding absorbs the -mx-2 bleed the fields use, so growing
            the body vertically never also produces a horizontal scrollbar. */}
        <div className='-mx-2 flex-1 overflow-y-auto px-2'>
          {/* No visible label: the placeholder carries the ask, and the
              accessible name comes from aria-label. No focus ring either —
              browsers match :focus-visible on a text input for a plain mouse
              click, so any ring here would box in whichever line you are
              editing, which is the chrome this layout exists to avoid. The
              caret is the focus affordance. */}
          <input
            ref={nameRef}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={label('milestone.dialog.name.placeholder')}
            aria-label={label('milestone.field.name')}
            className='-mx-2 block w-[calc(100%+1rem)] bg-transparent px-2 text-xl font-semibold leading-[1.4] text-foreground outline-none placeholder:font-semibold placeholder:text-muted-foreground/50'
          />

          <div className='mt-1.5'>
            <AutoGrowTextarea
              value={description}
              onChange={setDescription}
              placeholder={label('milestone.dialog.description.placeholder')}
              ariaLabel={label('milestone.field.description')}
            />
          </div>

          <div className='mt-5 flex flex-wrap items-center gap-2'>
            <DatePill
              label={label('milestone.dates.start')}
              ariaLabel={label('milestone.field.startDate')}
              value={startDate}
              onChange={setStartDate}
            />
            <span aria-hidden className='text-[13px] text-muted-foreground/60'>
              →
            </span>
            <DatePill
              label={label('milestone.dates.target')}
              ariaLabel={label('milestone.field.targetDate')}
              value={targetDate}
              onChange={setTargetDate}
            />
            {editing && (
              <Select
                value={status}
                onValueChange={v => setStatus(v as MilestoneStatus)}
              >
                {/* Same chip as the two dates — muted word, then the value.
                    The trigger's own `border-input` and elevation are dropped
                    so the third chip in the row doesn't read as a form control
                    that wandered in next to two flat pills. */}
                <SelectTrigger
                  aria-label={label('milestone.field.status')}
                  className='h-auto w-auto gap-1.5 rounded-full border-border px-3 py-1 text-[13px] shadow-none'
                >
                  <span className='text-muted-foreground'>
                    {label('milestone.field.status')}
                  </span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MILESTONE_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>
                      {label(`milestone.status.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {/* A first-time nudge only: on an existing milestone the row is
                already crowded by the status chip, and the hint would wrap to
                a line of its own for something the user has settled. */}
            {!editing && (
              <span className='ml-1 text-xs text-muted-foreground/70'>
                {label('milestone.dialog.dates.optional')}
              </span>
            )}
          </div>

          {failed && (
            <p
              role='alert'
              aria-live='polite'
              className='mt-4 text-sm text-danger'
            >
              {label('milestone.save.error')}
            </p>
          )}
        </div>

        <div className='mt-6 flex shrink-0 items-center justify-end gap-2'>
          <Button variant='ghost' onClick={onClose} disabled={busy}>
            {label('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy && <Spinner className='size-4' />}
            {busy
              ? label(editing ? 'common.saving' : 'common.creating')
              : label(editing ? 'common.save' : 'common.create')}
            <kbd className='rounded-sm bg-primary-foreground/15 px-1.5 py-px text-[11px] font-normal text-primary-foreground/70'>
              {submitModLabel}↵
            </kbd>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** A borderless paragraph that grows to fit its text, so the description reads
 *  as prose rather than a fixed-height box with a scrollbar and a resize grip.
 *
 *  The growth is pure CSS: the textarea and an invisible mirror span share one
 *  grid cell, so the cell — and with it the textarea — is sized by the mirror's
 *  wrapped text. Measuring scrollHeight from an effect instead would re-enter
 *  layout on every keystroke; this has no such failure mode and behaves
 *  identically under jsdom. */
function AutoGrowTextarea({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string
  onChange: (text: string) => void
  placeholder: string
  ariaLabel: string
}): ReactNode {
  const shared =
    '[grid-area:1/1/2/2] px-2 text-[15px] leading-[1.75] whitespace-pre-wrap break-words'

  // The floor is for the empty state only: it gives a blank milestone room to
  // invite a paragraph. Once there is prose it would be dead space under a
  // one-line description — which is exactly the shape an existing milestone
  // opens in.
  const floor = value ? '' : 'min-h-[72px]'

  return (
    <div className={`-mx-2 grid w-[calc(100%+1rem)] ${floor}`}>
      <textarea
        rows={1}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`${shared} resize-none overflow-hidden bg-transparent text-foreground outline-none placeholder:text-muted-foreground/60`}
      />
      {/* The mirror. The trailing space reserves room for a line still being
          typed, and for a lone trailing newline. */}
      <span aria-hidden className={`${shared} invisible`}>
        {value + ' '}
      </span>
    </div>
  )
}

/** A date as a chip: a muted word plus a bare native date input. Clicking
 *  anywhere on the chip opens the picker, since the whole thing is one label. */
function DatePill({
  label,
  ariaLabel,
  value,
  onChange,
}: {
  label: string
  ariaLabel: string
  value: string
  onChange: (value: string) => void
}): ReactNode {
  return (
    <label className='flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[13px] transition-colors hover:bg-muted/60'>
      <span className='text-muted-foreground'>{label}</span>
      <input
        type='date'
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={ariaLabel}
        className='cursor-pointer bg-transparent text-[13px] text-foreground outline-none'
      />
    </label>
  )
}
