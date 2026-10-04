'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'

export interface RetentionRowOption {
  value: string
  label: string
}

interface RetentionRowProps {
  /** Stable id for the select (label `htmlFor`) and test ids. */
  id: string
  label: string
  description: string
  /** Extra explanatory lines under the description. */
  notes?: ReactNode
  options: RetentionRowOption[]
  value: string
  onChange: (value: string) => void
  /** Shown under the select when the pending choice is stricter than the saved one. */
  warning?: string | null
  saving: boolean
  onSave: () => void
}

/**
 * LUM-933 — one data category in Settings → Data retention: what is kept,
 * the choice, and its own save button. Presentational only; each category's
 * row owns its state and API call.
 */
export function RetentionRow({
  id,
  label,
  description,
  notes,
  options,
  value,
  onChange,
  warning,
  saving,
  onSave,
}: RetentionRowProps) {
  const intl = useIntl()
  return (
    <div
      data-testid={`retention-row-${id}`}
      className='px-5 py-4 border-b border-border last:border-b-0'
    >
      <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4'>
        <div className='min-w-0 sm:flex-1'>
          <label
            htmlFor={`retention-${id}`}
            className='text-sm font-medium text-foreground'
          >
            {label}
          </label>
          <p className='text-xs text-muted-foreground mt-0.5'>{description}</p>
          {notes}
        </div>
        <div className='flex items-center gap-2 sm:shrink-0'>
          <select
            id={`retention-${id}`}
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={saving}
            className='h-8 min-w-0 flex-1 sm:w-72 sm:flex-none rounded-md border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed'
          >
            {options.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Button size='sm' onClick={onSave} disabled={saving}>
            {saving
              ? intl.formatMessage({ id: 'common.saving' })
              : intl.formatMessage({ id: 'common.save' })}
          </Button>
        </div>
      </div>
      {warning && (
        <p
          role='alert'
          data-testid={`retention-warning-${id}`}
          className='mt-2 rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-xs text-warning-text'
        >
          {warning}
        </p>
      )}
    </div>
  )
}
