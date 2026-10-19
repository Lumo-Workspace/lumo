'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useIntl } from 'react-intl'
import type { MemoryCategory } from '@prisma/client'
import type { MemoryRow } from '@/lib/api-client'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { isSubmitShortcut, submitModLabel } from '../../utils'
import {
  MEMORY_CATEGORIES,
  MEMORY_CATEGORY_SPECS,
  type MemoryDraft,
  type MemoryFieldSpec,
} from './forms/fieldSpecs'

export interface MemorySubmitPayload {
  category: MemoryCategory
  content: unknown
}

interface MemoryEditDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  editing?: MemoryRow
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: MemorySubmitPayload) => void | Promise<void>
  submitting: boolean
}

interface FormState {
  category: MemoryCategory
  draft: MemoryDraft
}

/** Fresh state for the dialog. Create mode opens on TRAP with empty fields —
 *  the form is visible immediately rather than behind a "pick a category"
 *  step, so the shape of a memory is legible before you commit to one. */
function initialState(mode: 'create' | 'edit', editing?: MemoryRow): FormState {
  if (mode === 'edit' && editing) {
    return {
      category: editing.category,
      draft: MEMORY_CATEGORY_SPECS[editing.category].fromContent(
        editing.content
      ),
    }
  }
  return { category: 'TRAP', draft: MEMORY_CATEGORY_SPECS.TRAP.blank() }
}

export function MemoryEditDialog({
  open,
  mode,
  editing,
  onOpenChange,
  onSubmit,
  submitting,
}: MemoryEditDialogProps) {
  const intl = useIntl()
  const [state, setState] = useState<FormState>(() =>
    initialState(mode, editing)
  )
  const titleRef = useRef<HTMLInputElement>(null)

  // Reset the form whenever the dialog (re)opens, so a reused instance never
  // shows the previous row's data. Depends on `open` only — re-running on
  // mode/editing changes mid-open would clobber in-progress input. Consumers
  // may still remount via React key; this is the defensive belt-and-suspenders.
  useEffect(() => {
    if (open) setState(initialState(mode, editing))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const spec = MEMORY_CATEGORY_SPECS[state.category]
  const valid = spec.isValid(state.draft)
  const canSubmit = valid && !submitting

  // Editing can only patch `content`, never `category` — swapping the pill on
  // an existing memory would post a payload whose shape no longer matches the
  // stored category. So edit mode shows the category as a static chip.
  const categoryLocked = mode === 'edit'

  const setField = (key: string, text: string) =>
    setState(s => ({ ...s, draft: { ...s.draft, [key]: text } }))

  const selectCategory = (category: MemoryCategory) =>
    setState(s =>
      s.category === category
        ? s
        : { category, draft: MEMORY_CATEGORY_SPECS[category].blank() }
    )

  const handleSubmit = async () => {
    if (!canSubmit) return
    await onSubmit({
      category: state.category,
      content: spec.toContent(state.draft),
    })
  }

  // The submit shortcut is advertised on the CTA itself (same shape as the new
  // task / new project modals). Enter alone stays a newline — every field is a
  // paragraph.
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isSubmitShortcut(e)) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  const titleId =
    mode === 'create'
      ? 'memory.dialog.create.title'
      : 'memory.dialog.edit.title'
  const ctaId =
    mode === 'create' ? 'memory.dialog.create.cta' : 'memory.dialog.edit.cta'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The body scrolls, the footer does not: PROCEDURAL/DECISION carry four
          fields, which on a short viewport would otherwise push the save button
          off the bottom of an otherwise single-page form. */}
      <DialogContent
        className='flex max-h-[85vh] flex-col gap-0 p-8 sm:max-w-[660px]'
        onKeyDown={handleKeyDown}
        // Default autofocus lands on the title and selects its whole value
        // (the browser's tab-into-a-text-input behaviour), so in edit mode the
        // first keystroke would wipe an existing title. Focus it ourselves with
        // the caret collapsed at the end instead.
        onOpenAutoFocus={event => {
          const el = titleRef.current
          if (!el) return
          event.preventDefault()
          el.focus()
          el.setSelectionRange(el.value.length, el.value.length)
        }}
      >
        <DialogHeader className='mb-5'>
          <DialogTitle className='text-title'>
            {intl.formatMessage({ id: titleId })}
          </DialogTitle>
        </DialogHeader>

        <div className='mb-7 flex flex-wrap gap-2'>
          {MEMORY_CATEGORIES.filter(
            c => !categoryLocked || c === state.category
          ).map(category => (
            <CategoryPill
              key={category}
              category={category}
              selected={category === state.category}
              locked={categoryLocked}
              onSelect={selectCategory}
            />
          ))}
        </div>

        {/* The inset padding exactly absorbs the -mx-2 bleed the title and the
            fields use for their focus rings, so growing this box vertically
            never also produces a horizontal scrollbar. */}
        <div className='-mx-2 flex-1 overflow-y-auto px-2'>
          <input
            ref={titleRef}
            value={state.draft.summary ?? ''}
            onChange={e => setField('summary', e.target.value)}
            placeholder={intl.formatMessage({ id: spec.summaryPlaceholderId })}
            aria-label={intl.formatMessage({
              id: 'memory.field.summary.label',
            })}
            className='-mx-2 mb-6 w-[calc(100%+1rem)] bg-transparent px-2 text-heading text-foreground outline-none placeholder:text-muted-foreground/50'
          />

          {spec.fields.map(field => (
            <FieldRow
              key={field.key}
              field={field}
              value={state.draft[field.key] ?? ''}
              onChange={text => setField(field.key, text)}
            />
          ))}
        </div>

        <div className='mt-3 flex shrink-0 items-center justify-end pt-2'>
          <div className='flex shrink-0 gap-2'>
            <Button
              type='button'
              variant='ghost'
              onClick={() => onOpenChange(false)}
            >
              {intl.formatMessage({ id: 'memory.dialog.cancel' })}
            </Button>
            <Button type='button' disabled={!canSubmit} onClick={handleSubmit}>
              {intl.formatMessage({ id: ctaId })} {submitModLabel}↵
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** A category chip: 7px color dot + name. Selected inverts to the primary
 *  surface; the dot is the dialog's entire color budget. */
function CategoryPill({
  category,
  selected,
  locked,
  onSelect,
}: {
  category: MemoryCategory
  selected: boolean
  locked: boolean
  onSelect: (category: MemoryCategory) => void
}) {
  const intl = useIntl()
  const spec = MEMORY_CATEGORY_SPECS[category]
  const label = intl.formatMessage({ id: spec.labelId })
  const skin = selected
    ? 'bg-primary text-body-strong text-primary-foreground'
    : 'bg-muted text-body text-muted-foreground hover:bg-accent hover:text-accent-foreground'
  const shared = `flex items-center gap-1.5 rounded-full px-3.5 py-1 ${skin}`
  // On the selected (primary) pill a ring keeps the dot >= 3:1 in both modes.
  const dotClass = selected
    ? 'size-[7px] rounded-full ring-1 ring-primary-foreground'
    : 'size-[7px] rounded-full'

  if (locked) {
    return (
      <span className={shared}>
        <span aria-hidden className={`${dotClass} ${spec.dot}`} />
        {label}
      </span>
    )
  }

  return (
    <button
      type='button'
      aria-pressed={selected}
      onClick={() => onSelect(category)}
      className={`${shared} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
    >
      <span aria-hidden className={`${dotClass} ${spec.dot}`} />
      {label}
    </button>
  )
}

/** One paragraph field: small uppercase label (with `*` when required) above a
 *  borderless multi-line body, so the dialog reads as a document rather than a
 *  stack of boxed inputs.
 *
 *  A focused field is styled exactly like an unfocused one — no ring, no tint.
 *  Browsers match `:focus-visible` on text fields even for a plain mouse click,
 *  so any focus decoration here draws a box around whichever paragraph you are
 *  editing, which is the chrome this layout exists to avoid. The blinking caret
 *  the browser renders is the focus affordance; it is present for keyboard and
 *  pointer alike, so nothing is lost by not painting one ourselves. */
function FieldRow({
  field,
  value,
  onChange,
}: {
  field: MemoryFieldSpec
  value: string
  onChange: (text: string) => void
}) {
  const intl = useIntl()
  const label = intl.formatMessage({ id: field.labelId })

  // A field grows to fit its text, so it reads as a paragraph rather than a
  // fixed-height control with a scrollbar or a resize grip.
  //
  // The growth is pure CSS: the textarea and an invisible mirror span share one
  // grid cell, so the cell — and with it the textarea — is sized by the mirror's
  // wrapped text. Measuring scrollHeight from an effect instead would re-enter
  // layout on every keystroke and depends on the reset landing before the read;
  // this has no such failure mode, and works identically under jsdom.
  const shared =
    '[grid-area:1/1/2/2] px-2 py-0.5 text-body whitespace-pre-wrap break-words'

  return (
    <div className='pb-4'>
      <Label
        htmlFor={`memory-field-${field.key}`}
        className='mb-1.5 block text-caption uppercase text-muted-foreground'
      >
        {label}
        {field.required && <span aria-hidden> *</span>}
      </Label>
      <div className='-mx-2 grid w-[calc(100%+1rem)]'>
        <textarea
          id={`memory-field-${field.key}`}
          rows={1}
          required={field.required}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={intl.formatMessage({ id: field.placeholderId })}
          className={`${shared} resize-none overflow-hidden bg-transparent text-foreground outline-none placeholder:text-muted-foreground/60`}
        />
        {/* The mirror. The trailing space reserves room for a line the user is
            still typing, and a lone trailing newline. */}
        <span aria-hidden className={`${shared} invisible`}>
          {value + ' '}
        </span>
      </div>
    </div>
  )
}
