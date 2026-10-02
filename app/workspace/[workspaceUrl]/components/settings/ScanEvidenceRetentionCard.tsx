'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { workspacesClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import {
  DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS,
  SCAN_EVIDENCE_HARD_CAP_DAYS,
  SCAN_EVIDENCE_RETENTION_DAYS,
  isScanEvidenceRetentionDays,
  type ScanEvidenceRetentionDays,
} from '@/lib/security-scan/evidence-retention'

interface ScanEvidenceRetentionCardProps {
  /** The stored setting, in days; 0 = zero retention. */
  initialDays: number | null
}

/**
 * LUM-911 — OWNER-only control for how long a used-up security scan keeps
 * the code it quoted. 7 days by default; 0 clears it once the review is
 * posted.
 */
export function ScanEvidenceRetentionCard({
  initialDays,
}: ScanEvidenceRetentionCardProps) {
  const intl = useIntl()
  const [days, setDays] = useState<ScanEvidenceRetentionDays>(
    isScanEvidenceRetentionDays(initialDays)
      ? initialDays
      : DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS
  )
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await workspacesClient.updateMe({ scanEvidenceRetentionDays: days })
      toast.success(
        intl.formatMessage({ id: 'workspaceSettings.scanEvidence.updated' })
      )
    } catch {
      toast.error(
        intl.formatMessage({
          id: 'workspaceSettings.scanEvidence.updateFailed',
        })
      )
    } finally {
      setSaving(false)
    }
  }

  const optionLabel = (d: ScanEvidenceRetentionDays) => {
    if (d === 0)
      return intl.formatMessage({ id: 'workspaceSettings.scanEvidence.zero' })
    return intl.formatMessage(
      {
        id:
          d === DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS
            ? 'workspaceSettings.scanEvidence.daysDefault'
            : 'workspaceSettings.scanEvidence.days',
      },
      { days: d }
    )
  }

  return (
    <div
      data-testid='scan-evidence-retention-card'
      className='rounded-lg border border-border overflow-hidden mb-8'
    >
      <div className='px-5 py-3 border-b border-border'>
        <p className='text-sm font-semibold text-foreground'>
          {intl.formatMessage({ id: 'workspaceSettings.scanEvidence.title' })}
        </p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          {intl.formatMessage({
            id: 'workspaceSettings.scanEvidence.description',
          })}
        </p>
        <p className='text-xs text-muted-foreground mt-1'>
          {intl.formatMessage(
            { id: 'workspaceSettings.scanEvidence.openCap' },
            { days: SCAN_EVIDENCE_HARD_CAP_DAYS }
          )}
        </p>
      </div>

      <div className='flex items-center justify-between gap-4 px-5 py-4 border-b border-border'>
        <label
          htmlFor='scan-evidence-retention'
          className='text-sm font-medium text-foreground'
        >
          {intl.formatMessage({ id: 'workspaceSettings.scanEvidence.label' })}
        </label>
        <select
          id='scan-evidence-retention'
          value={days}
          onChange={e => {
            const next = Number(e.target.value)
            if (isScanEvidenceRetentionDays(next)) setDays(next)
          }}
          disabled={saving}
          className='h-8 rounded-md border border-border bg-transparent px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed'
        >
          {SCAN_EVIDENCE_RETENTION_DAYS.map(d => (
            <option key={d} value={d}>
              {optionLabel(d)}
            </option>
          ))}
        </select>
      </div>

      {days === 0 && (
        <p
          data-testid='scan-evidence-zero-hint'
          className='px-5 py-3 border-b border-border text-xs text-muted-foreground'
        >
          {intl.formatMessage({
            id: 'workspaceSettings.scanEvidence.zeroHint',
          })}
        </p>
      )}

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
