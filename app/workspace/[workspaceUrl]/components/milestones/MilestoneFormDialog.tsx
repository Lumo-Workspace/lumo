'use client'

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { CalendarDays } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { milestonesClient, type ApiMilestone } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import { formatCalendarDate } from '@/lib/datetime/format'
import { isSubmitShortcut, submitModLabel } from '../../utils'
import { DescriptionEditor } from '../DescriptionEditorLazy'
import { useMentionSources } from '../../hooks/useMentionSources'
import { useMembers } from '../../hooks/useMembers'
import { CalendarDayPopover } from '../fields/CalendarDayPicker'

interface Props {
  projectId: string
  milestone?: ApiMilestone | undefined
  onClose: () => void
}

/* Status is deliberately absent from this form: it is edited on the milestone
   detail page's sidebar, which is where the status drift hint and the archived
   state live too. Two editors for one field meant the dialog could hand you a
   stale value to save back. */

/** A description that renders to nothing but markup (an empty paragraph the
 *  editor always keeps around) is stored as `null`, not as `<p></p>` — same
 *  test the new-task modal uses, so both write the field the same way. */
function htmlOrNull(html: string | null): string | null {
  return html?.replace(/<[^>]*>/g, '').trim() ? html : null
}

export function MilestoneFormDialog({ projectId, milestone, onClose }: Props) {
  const intl = useIntl()
  const qc = useQueryClient()
  const editing = !!milestone
  const nameRef = useRef<HTMLInputElement>(null)

  const { members } = useMembers()
  const mentionSources = useMentionSources(members)

  const [name, setName] = useState(milestone?.name ?? '')
  const [description, setDescription] = useState<string | null>(
    milestone?.description ?? null
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
        description: htmlOrNull(description),
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
        description: htmlOrNull(description),
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
          <DialogTitle className='text-title'>
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
            className='-mx-2 block w-[calc(100%+1rem)] bg-transparent px-2 text-heading text-foreground outline-none placeholder:text-muted-foreground/50'
          />

          {/* The same editor a task description gets — rich text, @-mentions,
              slash commands — so a milestone body is written and stored the
              way every other body in the app is. The service already treats
              this field as HTML (it diffs it for @-mention notifications); the
              plain textarea that used to sit here was the odd one out. */}
          {/* No min-height of our own: the shared editor already carries an
              80px floor, the same one a task body sits on. */}
          <div className='mt-1.5'>
            <DescriptionEditor
              value={description}
              onChange={html => setDescription(html)}
              onCommit={html => setDescription(html)}
              placeholder={label('milestone.dialog.description.placeholder')}
              mentionSources={mentionSources}
            />
          </div>

          <div className='mt-5 flex flex-wrap items-center gap-2'>
            <DatePill
              label={label('milestone.dates.start')}
              ariaLabel={label('milestone.field.startDate')}
              value={startDate}
              placeholder={label('milestone.hero.notSet')}
              onChange={setStartDate}
            />
            <span aria-hidden className='text-body text-muted-foreground/60'>
              →
            </span>
            <DatePill
              label={label('milestone.dates.target')}
              ariaLabel={label('milestone.field.targetDate')}
              value={targetDate}
              placeholder={label('milestone.hero.notSet')}
              onChange={setTargetDate}
            />
          </div>

          {failed && (
            <p
              role='alert'
              aria-live='polite'
              className='mt-4 text-body text-danger-text'
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
            <kbd className='rounded-sm bg-primary-foreground/15 px-1.5 py-px text-caption font-normal text-primary-foreground/70'>
              {submitModLabel}↵
            </kbd>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** A date as a chip: a muted word plus the picked day. The whole chip is the
 *  trigger of the shared calendar picker; clicking the picked day again
 *  clears it. */
function DatePill({
  label,
  ariaLabel,
  value,
  placeholder,
  onChange,
}: {
  label: string
  ariaLabel: string
  value: string
  placeholder: string
  onChange: (value: string) => void
}): ReactNode {
  const intl = useIntl()
  return (
    <CalendarDayPopover value={value} onChange={onChange} clearable>
      <button
        type='button'
        aria-label={ariaLabel}
        className='flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-body transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
      >
        <span className='text-muted-foreground'>{label}</span>
        <span className={value ? 'text-foreground' : 'text-muted-foreground'}>
          {value ? formatCalendarDate(value, intl.locale) : placeholder}
        </span>
        <CalendarDays className='size-4 text-muted-foreground' />
      </button>
    </CalendarDayPopover>
  )
}
