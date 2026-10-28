'use client'

import { useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { useIntl } from 'react-intl'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface ChipInputProps {
  id: string
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string | undefined
  disabled?: boolean | undefined
  /** An error message for a value that can't be added; null = fine. */
  validate?: ((value: string) => string | null) | undefined
  'aria-describedby'?: string | undefined
}

/**
 * LUM-1331 — a list setting as chips: Enter, a comma or a paste of several
 * lines adds; each chip removes on its ×; Backspace in the empty field
 * removes the last one. Blanks and repeats are never added.
 */
export function ChipInput({
  id,
  values,
  onChange,
  placeholder,
  disabled = false,
  validate,
  'aria-describedby': describedBy,
}: ChipInputProps) {
  const intl = useIntl()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const errorId = `${id}-error`

  const add = (raw: readonly string[]): boolean => {
    const next = [...values]
    for (const r of raw) {
      const v = r.trim()
      if (v.length === 0 || next.includes(v)) continue
      const problem = validate?.(v) ?? null
      if (problem) {
        setError(problem)
        return false
      }
      next.push(v)
    }
    setError(null)
    if (next.length !== values.length) onChange(next)
    return true
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (add([text])) setText('')
    } else if (e.key === 'Backspace' && text === '' && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text')
    if (!/[\n,]/.test(pasted)) return
    e.preventDefault()
    if (add(pasted.split(/[\n,]/))) setText('')
  }

  return (
    <div className='flex flex-col gap-1'>
      <div
        className={cn(
          'flex min-h-control-md flex-wrap items-center gap-1 rounded-md border border-border bg-background px-2 py-1 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
          error && 'border-destructive',
          disabled && 'opacity-50'
        )}
      >
        {values.map(v => (
          <Badge
            key={v}
            variant='muted'
            size='xs'
            shape='square'
            className='h-6 gap-0.5 font-mono text-foreground'
          >
            {v}
            {!disabled && (
              <button
                type='button'
                className='inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
                aria-label={intl.formatMessage(
                  { id: 'workspaceSettings.repoReview.chips.remove' },
                  { value: v }
                )}
                onClick={() => onChange(values.filter(x => x !== v))}
              >
                <X className='size-3' aria-hidden='true' />
              </button>
            )}
          </Badge>
        ))}
        {disabled && values.length === 0 && (
          <span className='text-body text-muted-foreground'>
            {intl.formatMessage({
              id: 'workspaceSettings.repoReview.chips.none',
            })}
          </span>
        )}
        {!disabled && (
          <input
            id={id}
            value={text}
            placeholder={placeholder}
            aria-invalid={error ? true : undefined}
            aria-describedby={
              [error ? errorId : null, describedBy].filter(Boolean).join(' ') ||
              undefined
            }
            className='h-6 min-w-[8rem] flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground'
            onChange={e => {
              setText(e.target.value)
              setError(null)
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => {
              if (add([text])) setText('')
            }}
          />
        )}
      </div>
      {error && (
        <p id={errorId} className='text-caption text-danger-text'>
          {error}
        </p>
      )}
    </div>
  )
}
