'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import {
  DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS,
  SCAN_EVIDENCE_HARD_CAP_DAYS,
  SCAN_EVIDENCE_RETENTION_DAYS,
  isScanEvidenceRetentionDays,
  type ScanEvidenceRetentionDays,
} from '@/ee/security/security-scan/evidence-retention'
import { RetentionRow } from '@/app/workspace/[workspaceUrl]/components/settings/RetentionRow'
import { useRetentionSave } from '@/app/workspace/[workspaceUrl]/components/settings/useRetentionSave'

interface ScanEvidenceRetentionRowProps {
  /** The stored setting, in days; 0 = zero retention. */
  initialDays: number | null
}

/**
 * LUM-911 — how long a used-up security scan keeps the code it quoted.
 * 7 days by default; 0 clears it once the review is posted. Behaviour is
 * unchanged by LUM-933; only its place moved into Data retention.
 */
export function ScanEvidenceRetentionRow({
  initialDays,
}: ScanEvidenceRetentionRowProps) {
  const intl = useIntl()
  const [saved, setSaved] = useState<ScanEvidenceRetentionDays>(
    isScanEvidenceRetentionDays(initialDays)
      ? initialDays
      : DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS
  )
  const [days, setDays] = useState<ScanEvidenceRetentionDays>(saved)
  const { saving, save } = useRetentionSave()

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

  const handleSave = async () => {
    if (await save({ scanEvidenceRetentionDays: days })) setSaved(days)
  }

  return (
    <RetentionRow
      id='scan-evidence'
      label={intl.formatMessage({ id: 'dataRetention.scan.label' })}
      description={intl.formatMessage({
        id: 'workspaceSettings.scanEvidence.description',
      })}
      notes={
        <>
          <p className='text-caption text-muted-foreground mt-1'>
            {intl.formatMessage(
              { id: 'workspaceSettings.scanEvidence.openCap' },
              { days: SCAN_EVIDENCE_HARD_CAP_DAYS }
            )}
          </p>
          {days === 0 && (
            <p
              data-testid='scan-evidence-zero-hint'
              className='text-caption text-muted-foreground mt-1'
            >
              {intl.formatMessage({
                id: 'workspaceSettings.scanEvidence.zeroHint',
              })}
            </p>
          )}
        </>
      }
      options={SCAN_EVIDENCE_RETENTION_DAYS.map(d => ({
        value: String(d),
        label: optionLabel(d),
      }))}
      value={String(days)}
      onChange={v => {
        const next = Number(v)
        if (isScanEvidenceRetentionDays(next)) setDays(next)
      }}
      warning={
        days < saved
          ? intl.formatMessage({ id: 'dataRetention.shortenWarning' })
          : null
      }
      saving={saving}
      onSave={handleSave}
    />
  )
}
