'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { workspacesClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import {
  HOOK_EVENT_RETENTION_DAYS,
  isHookEventRetentionDays,
  type HookEventRetentionDays,
} from '@/lib/hook-event/retention'

interface HookEventRetentionCardProps {
  /** The stored setting; null = keep forever. */
  initialDays: number | null
}

const OFF = 'off'

/**
 * LUM-859 — OWNER-only control for how long raw agent events (the content of
 * reads, edits, command output and prompts) are kept. Off by default.
 */
export function HookEventRetentionCard({
  initialDays,
}: HookEventRetentionCardProps) {
  const intl = useIntl()
  const [days, setDays] = useState<HookEventRetentionDays | null>(
    isHookEventRetentionDays(initialDays) ? initialDays : null
  )
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await workspacesClient.updateMe({ hookEventRetentionDays: days })
      toast.success(
        intl.formatMessage({ id: 'workspaceSettings.retention.updated' })
      )
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'workspaceSettings.retention.updateFailed',
            })
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='rounded-lg border border-border overflow-hidden mb-8'>
      <div className='px-5 py-3 border-b border-border'>
        <p className='text-sm font-semibold text-foreground'>
          {intl.formatMessage({ id: 'workspaceSettings.retention.title' })}
        </p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          {intl.formatMessage({
            id: 'workspaceSettings.retention.description',
          })}
        </p>
        <p className='text-xs text-muted-foreground mt-1'>
          {intl.formatMessage({ id: 'workspaceSettings.retention.exemptions' })}
        </p>
      </div>

      <div className='flex items-center justify-between gap-4 px-5 py-4 border-b border-border'>
        <label
          htmlFor='hook-event-retention'
          className='text-sm font-medium text-foreground'
        >
          {intl.formatMessage({ id: 'workspaceSettings.retention.label' })}
        </label>
        <select
          id='hook-event-retention'
          value={days ?? OFF}
          onChange={e => {
            const next = Number(e.target.value)
            setDays(isHookEventRetentionDays(next) ? next : null)
          }}
          disabled={saving}
          className='h-8 rounded-md border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed'
        >
          <option value={OFF}>
            {intl.formatMessage({ id: 'workspaceSettings.retention.off' })}
          </option>
          {HOOK_EVENT_RETENTION_DAYS.map(d => (
            <option key={d} value={d}>
              {intl.formatMessage(
                { id: 'workspaceSettings.retention.days' },
                { days: d }
              )}
            </option>
          ))}
        </select>
      </div>

      <div className='flex justify-end px-5 py-4'>
        <Button size='sm' onClick={handleSave} disabled={saving}>
          {saving
            ? intl.formatMessage({ id: 'common.saving' })
            : intl.formatMessage({ id: 'common.save' })}
        </Button>
      </div>
    </div>
  )
}
