'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { workspacesClient } from '@/lib/api-client'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

type Column = 'doneRequiresTestCase' | 'doneRequiresReview'

interface DoneRequirementsCardProps {
  /** The stored switches; null (not loaded) reads as off, the default. */
  testCase: boolean | null
  review: boolean | null
}

const ROWS: Array<{ column: Column; key: 'testCase' | 'review' }> = [
  { column: 'doneRequiresTestCase', key: 'testCase' },
  { column: 'doneRequiresReview', key: 'review' },
]

/**
 * LUM-1334 — two OWNER switches that tighten the DONE gate for tasks with a
 * linked pull request: a passing test case, and a review, on each PR's latest
 * commit. Off by default. Each switch saves when flipped and flips back if
 * the server refuses.
 */
export function DoneRequirementsCard({
  testCase,
  review,
}: DoneRequirementsCardProps) {
  const intl = useIntl()
  const [values, setValues] = useState({
    testCase: testCase === true,
    review: review === true,
  })
  const [saving, setSaving] = useState<Column | null>(null)

  const handleToggle = async (
    column: Column,
    key: 'testCase' | 'review',
    next: boolean
  ) => {
    setValues(v => ({ ...v, [key]: next }))
    setSaving(column)
    try {
      await workspacesClient.updateMe({ [column]: next })
      toast.success(
        intl.formatMessage({ id: 'workspaceSettings.doneRequirements.saved' })
      )
    } catch (err) {
      setValues(v => ({ ...v, [key]: !next }))
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'workspaceSettings.doneRequirements.saveFailed',
            })
      )
    } finally {
      setSaving(null)
    }
  }

  return (
    <div
      data-testid='done-requirements-card'
      className='rounded-lg border border-border overflow-hidden'
    >
      <p className='px-5 py-3 border-b border-border text-caption text-muted-foreground'>
        {intl.formatMessage({
          id: 'workspaceSettings.doneRequirements.description',
        })}
      </p>
      {ROWS.map(({ column, key }, i) => (
        <div
          key={column}
          className={`flex items-center justify-between gap-4 px-5 py-4 ${
            i < ROWS.length - 1 ? 'border-b border-border' : ''
          }`}
        >
          <div className='min-w-0'>
            <Label
              htmlFor={`done-requirement-${key}`}
              className='text-body-strong text-foreground'
            >
              {intl.formatMessage({
                id: `workspaceSettings.doneRequirements.${key}.label`,
              })}
            </Label>
            <p className='text-caption text-muted-foreground mt-0.5'>
              {intl.formatMessage({
                id: `workspaceSettings.doneRequirements.${key}.description`,
              })}
            </p>
          </div>
          <Switch
            id={`done-requirement-${key}`}
            data-testid={`done-requirement-${key}`}
            checked={values[key]}
            disabled={saving !== null}
            onCheckedChange={next => void handleToggle(column, key, next)}
          />
        </div>
      ))}
    </div>
  )
}
