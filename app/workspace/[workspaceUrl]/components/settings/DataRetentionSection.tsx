'use client'

import { useIntl } from 'react-intl'
import { SessionRecordRetentionRow } from './SessionRecordRetentionRow'
import { CrossingRawRetentionRow } from './CrossingRawRetentionRow'
import { DeadLetterRetentionRow } from './DeadLetterRetentionRow'
import { AiDerivedContentRow } from './AiDerivedContentRow'
import { PluginSlot, type WorkspaceSettingsView } from '@/lib/plugins/client'

export interface DataRetentionSettings {
  hookEventRetentionMode: string | null
  hookEventRetentionDays: number | null
  crossingRawRetentionDays: number | null
  deadLetterRetentionDays: number | null
  /** LUM-917: null (not loaded) reads as on. */
  aiDerivedContentEnabled: boolean | null
}

/**
 * LUM-933 — Settings → Data retention: one row per kind of data, each saved
 * on its own. Rendered for OWNERs only (the API refuses everyone else).
 * Deleting AI-derived content lives in the danger zone (LUM-1327).
 */
export function DataRetentionSection({
  settings,
  workspace,
}: {
  settings: DataRetentionSettings
  /** LUM-1062: the workspace row, for plugin rows (scan evidence, LUM-911). */
  workspace: WorkspaceSettingsView
}) {
  const intl = useIntl()
  return (
    <section
      id='data-retention'
      data-testid='data-retention-section'
      className='rounded-lg border border-border overflow-hidden mb-8'
    >
      <div className='px-5 py-3 border-b border-border'>
        <h2 className='text-body-strong text-foreground'>
          {intl.formatMessage({ id: 'dataRetention.title' })}
        </h2>
        <p className='text-caption text-muted-foreground mt-0.5'>
          {intl.formatMessage({ id: 'dataRetention.description' })}
        </p>
      </div>
      <SessionRecordRetentionRow
        initialMode={settings.hookEventRetentionMode}
        initialDays={settings.hookEventRetentionDays}
      />
      <PluginSlot name='settings.retention.row' props={{ workspace }} />
      <CrossingRawRetentionRow
        initialDays={settings.crossingRawRetentionDays}
      />
      <DeadLetterRetentionRow initialDays={settings.deadLetterRetentionDays} />
      <AiDerivedContentRow initialEnabled={settings.aiDerivedContentEnabled} />
    </section>
  )
}
