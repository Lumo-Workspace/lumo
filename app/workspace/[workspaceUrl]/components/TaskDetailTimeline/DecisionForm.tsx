'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { CardContent, CardFooter } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import type { DecisionInput } from '../../hooks/useTaskDecisions'

interface DecisionFormProps {
  initial?: DecisionInput | undefined
  submitLabel: string
  onSubmit: (input: DecisionInput) => Promise<unknown>
  onCancel?: (() => void) | undefined
}

/**
 * LUM-1303: the decision (required) and its rationale (optional), laid out as
 * a card body + footer — the composer card and a card being edited both wrap
 * it in a `Card`. ⌘/Ctrl+Enter submits, Escape cancels.
 */
export function DecisionForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: DecisionFormProps) {
  const intl = useIntl()
  const [text, setText] = useState(initial?.text ?? '')
  const [rationale, setRationale] = useState(initial?.rationale ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = text.trim().length > 0 && !saving

  const submit = async () => {
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    try {
      await onSubmit({ text: text.trim(), rationale: rationale.trim() || null })
      if (!initial) {
        setText('')
        setRationale('')
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : intl.formatMessage({
              id: 'task.decisions.saveFailed',
              defaultMessage: 'Could not save the decision',
            })
      )
    } finally {
      setSaving(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit()
    }
    if (e.key === 'Escape' && onCancel) onCancel()
  }

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        void submit()
      }}
    >
      <CardContent className='space-y-2 p-4'>
        <Textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={2000}
          autoFocus
          // Editing: put the caret after the existing text, not before it.
          onFocus={e => {
            const end = e.currentTarget.value.length
            e.currentTarget.setSelectionRange(end, end)
          }}
          aria-label={intl.formatMessage({
            id: 'task.decisions.textLabel',
            defaultMessage: 'Decision',
          })}
          placeholder={intl.formatMessage({
            id: 'task.decisions.textPlaceholder',
            defaultMessage: 'What was decided?',
          })}
        />
        <Textarea
          value={rationale}
          onChange={e => setRationale(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={4000}
          aria-label={intl.formatMessage({
            id: 'task.decisions.rationaleLabel',
            defaultMessage: 'Why (optional)',
          })}
          placeholder={intl.formatMessage({
            id: 'task.decisions.rationalePlaceholder',
            defaultMessage: 'Why was it decided? (optional)',
          })}
        />
        {error ? (
          <p role='alert' className='text-caption text-danger-text'>
            {error}
          </p>
        ) : null}
      </CardContent>
      <CardFooter className='justify-between gap-2 p-4 pt-0'>
        <span className='text-caption text-muted-foreground'>
          {intl.formatMessage({
            id: 'task.decisions.submitHint',
            defaultMessage: '⌘/Ctrl + Enter to save',
          })}
        </span>
        <div className='flex gap-2'>
          {onCancel ? (
            <Button type='button' variant='ghost' size='sm' onClick={onCancel}>
              {intl.formatMessage({
                id: 'common.cancel',
                defaultMessage: 'Cancel',
              })}
            </Button>
          ) : null}
          <Button type='submit' size='sm' disabled={!canSubmit}>
            {submitLabel}
          </Button>
        </div>
      </CardFooter>
    </form>
  )
}
