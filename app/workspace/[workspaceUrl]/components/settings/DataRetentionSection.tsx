'use client'

import { useIntl } from 'react-intl'
import { SessionRecordRetentionRow } from './SessionRecordRetentionRow'
import { ScanEvidenceRetentionRow } from './ScanEvidenceRetentionRow'
import { CrossingRawRetentionRow } from './CrossingRawRetentionRow'
import { DeadLetterRetentionRow } from './DeadLetterRetentionRow'
import { AiDerivedContentRow } from './AiDerivedContentRow'
import { AiDerivedContentDeleteRow } from './AiDerivedContentDeleteRow'

export interface DataRetentionSettings {
  hookEventRetentionMode: string | null
  hookEventRetentionDays: number | null
  scanEvidenceRetentionDays: number | null
  crossingRawRetentionDays: number | null
  deadLetterRetentionDays: number | null
  /** LUM-917: null (not loaded) reads as on. */
  aiDerivedContentEnabled: boolean | null
}

/**
 * LUM-933 — Settings → Data retention: one row per kind of data, each saved
 * on its own. Rendered for OWNERs only (the API refuses everyone else).
 */
export function DataRetentionSection({
  settings,
  workspaceName,
}: {
  settings: DataRetentionSettings
  /** Re-typed to confirm deleting AI-derived content (LUM-917). */
  workspaceName: string
}) {
  const intl = useIntl()
  return (
    <section
      id='data-retention'
      data-testid='data-retention-section'
      className='rounded-lg border border-border overflow-hidden mb-8'
    >
      <div className='px-5 py-3 border-b border-border'>
        <h2 className='text-sm font-semibold text-foreground'>
          {intl.formatMessage({ id: 'dataRetention.title' })}
        </h2>
        <p className='text-xs text-muted-foreground mt-0.5'>
          {intl.formatMessage({ id: 'dataRetention.description' })}
        </p>
      </div>
      <SessionRecordRetentionRow
        initialMode={settings.hookEventRetentionMode}
        initialDays={settings.hookEventRetentionDays}
      />
      <ScanEvidenceRetentionRow
        initialDays={settings.scanEvidenceRetentionDays}
      />
      <CrossingRawRetentionRow
        initialDays={settings.crossingRawRetentionDays}
      />
      <DeadLetterRetentionRow initialDays={settings.deadLetterRetentionDays} />
      <AiDerivedContentRow initialEnabled={settings.aiDerivedContentEnabled} />
      <AiDerivedContentDeleteRow workspaceName={workspaceName} />
    </section>
  )
}
