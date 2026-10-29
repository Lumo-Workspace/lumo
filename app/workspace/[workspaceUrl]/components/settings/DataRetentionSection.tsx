'use client'

import { SessionRecordRetentionRow } from './SessionRecordRetentionRow'
import { CrossingRawRetentionRow } from './CrossingRawRetentionRow'
import { DeadLetterRetentionRow } from './DeadLetterRetentionRow'
import { PluginSlot, type WorkspaceSettingsView } from '@/lib/plugins/client'

export interface DataRetentionSettings {
  hookEventRetentionMode: string | null
  hookEventRetentionDays: number | null
  crossingRawRetentionDays: number | null
  deadLetterRetentionDays: number | null
}

/**
 * LUM-933 — Settings → Data retention: one row per kind of data, each saved
 * on its own. Rendered for OWNERs only (the API refuses everyone else); the
 * page around it carries the title and description.
 * The AI-generated content switch and its delete live on the AI page (LUM-1339).
 */
export function DataRetentionSection({
  settings,
  workspace,
  label,
}: {
  settings: DataRetentionSettings
  /** LUM-1062: the workspace row, for plugin rows (scan evidence, LUM-911). */
  workspace: WorkspaceSettingsView
  /** Accessible name of the section (the page's title). */
  label: string
}) {
  return (
    <section
      id='data-retention'
      aria-label={label}
      data-testid='data-retention-section'
      className='rounded-lg border border-border overflow-hidden'
    >
      <SessionRecordRetentionRow
        initialMode={settings.hookEventRetentionMode}
        initialDays={settings.hookEventRetentionDays}
      />
      <PluginSlot name='settings.retention.row' props={{ workspace }} />
      <CrossingRawRetentionRow
        initialDays={settings.crossingRawRetentionDays}
      />
      <DeadLetterRetentionRow initialDays={settings.deadLetterRetentionDays} />
    </section>
  )
}
