'use client'

import { useIntl } from 'react-intl'
import type { RunAttributionSummary } from '@/lib/attribution/run-attribution'
import { APPROXIMATE_NOTICE } from '../AgentRunTimeline/attribution-labels'

export interface AttributionSummaryProps {
  summary: RunAttributionSummary
}

/**
 * LUM-932: the Record tab's one-glance answer to "how was the work on this
 * task attributed?" — how many sessions were bound explicitly vs auto-detected,
 * plus the inaccuracy notice when any of it was auto-detected. Renders nothing
 * when no run has attributed work.
 */
export function AttributionSummary({ summary }: AttributionSummaryProps) {
  const intl = useIntl()
  const { explicit, inferred, approximate } = summary
  if (explicit + inferred === 0) return null

  const allBound = inferred === 0 && !approximate

  return (
    <div
      data-testid='attribution-summary'
      className='space-y-1 text-caption text-foreground'
    >
      <div>
        {allBound
          ? intl.formatMessage(
              {
                id: 'record.attribution.allBound',
                defaultMessage:
                  'Work on this task: {explicit, plural, one {# session} other {# sessions}}, all bound with lumo session attach',
              },
              { explicit }
            )
          : intl.formatMessage(
              {
                id: 'record.attribution.summary',
                defaultMessage:
                  'Work on this task: {explicit, plural, one {# session bound} other {# sessions bound}} · {inferred, plural, one {# auto-detected} other {# auto-detected}}',
              },
              { explicit, inferred }
            )}
      </div>
      {approximate ? (
        <div
          data-testid='attribution-approximate-notice'
          className='text-warning-text'
        >
          {intl.formatMessage(APPROXIMATE_NOTICE)}
        </div>
      ) : null}
      <div className='text-muted-foreground'>
        {intl.formatMessage(
          {
            id: 'record.attribution.seeRuns',
            defaultMessage:
              'See "{runsSection}" under {reportSection} for the signals behind each run.',
          },
          {
            // Same descriptors as the dossier's section titles, so the hint
            // names them exactly as the reader sees them.
            runsSection: intl.formatMessage({
              id: 'dossier.section.runs',
              defaultMessage: 'Agent runs',
            }),
            reportSection: intl.formatMessage({
              id: 'acceptance.runReport.title',
              defaultMessage: 'Run report',
            }),
          }
        )}
      </div>
    </div>
  )
}
