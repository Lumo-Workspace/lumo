'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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
            className='text-body-strong text-foreground'
          >
            {label}
          </label>
          <p className='text-caption text-muted-foreground mt-0.5'>
            {description}
          </p>
          {notes}
        </div>
        <div className='flex items-center gap-2 sm:shrink-0'>
          <Select value={value} onValueChange={onChange} disabled={saving}>
            <SelectTrigger
              id={`retention-${id}`}
              className='h-8 min-w-0 flex-1 sm:w-72 sm:flex-none text-foreground'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map(o => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size='sm' onClick={onSave} disabled={saving}>
            {saving
              ? intl.formatMessage({ id: 'common.saving' })
              : intl.formatMessage({ id: 'common.save' })}
          </Button>
        </div>
      </div>
      {warning && (
        <Alert
          variant='warning'
          size='sm'
          data-testid={`retention-warning-${id}`}
          className='mt-2'
        >
          <AlertTriangle />
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
