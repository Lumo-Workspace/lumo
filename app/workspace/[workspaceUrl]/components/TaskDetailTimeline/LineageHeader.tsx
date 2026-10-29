'use client'

import { useIntl } from 'react-intl'
import { Info } from 'lucide-react'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { LineageOutcome } from '../../types'

// Fixed display order for outcome rollups, mirroring the CLI's OUTCOME_ORDER
// (cli/src/commands/task-lineage.ts) so the web + terminal audit views agree.
const OUTCOME_ORDER: LineageOutcome[] = [
  'MERGED',
  'REWORKED',
  'REJECTED',
  'UNKNOWN',
]

const OUTCOME_BADGE: Record<LineageOutcome, BadgeProps['variant']> = {
  MERGED: 'success',
  REWORKED: 'warning',
  REJECTED: 'danger',
  UNKNOWN: 'outline-muted',
}

export interface LineageHeaderProps {
  impressions: number
  index: number
  used: number
  /** Edges with a used/unused vote; 0 = the agent never reported usefulness. */
  voted: number
  sessions: number
  outcomes: Record<LineageOutcome, number>
}

/**
 * LUM-1294: the lineage card's one-line conclusion + the task outcome (shown
 * once here instead of as a badge on every fragment row) + a notice when no
 * agent reported which fragments helped, so "0 used" is never read as "none
 * helped".
 */
export function LineageHeader({
  impressions,
  index,
  used,
  voted,
  sessions,
  outcomes,
}: LineageHeaderProps) {
  const intl = useIntl()
  const present = OUTCOME_ORDER.filter(o => outcomes[o] > 0)
  const outcomeLabel = (o: LineageOutcome) =>
    intl.formatMessage({
      id: `lineage.outcome.${o.toLowerCase()}`,
      defaultMessage: o.toLowerCase(),
    })

  const conclusion =
    voted > 0
      ? intl.formatMessage(
          {
            id: 'lineage.header.conclusionVoted',
            defaultMessage:
              '{used} of {impressions} injected items helped ({pct}%) · {sessions, plural, one {# session} other {# sessions}}',
          },
          {
            used,
            impressions,
            pct: Math.round((used / impressions) * 100),
            sessions,
          }
        )
      : intl.formatMessage(
          {
            id: 'lineage.header.conclusionUnvoted',
            defaultMessage:
              '{impressions, plural, one {# item} other {# items}} injected across {sessions, plural, one {# session} other {# sessions}} · {index} sent as a one-line index',
          },
          { impressions, sessions, index }
        )

  return (
    <div className='flex flex-col gap-2 border-b border-border px-3 py-3'>
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <p className='text-body text-foreground'>{conclusion}</p>
        <div className='flex flex-wrap gap-1'>
          {present.map(o => (
            <Badge key={o} variant={OUTCOME_BADGE[o]} size='sm'>
              {present.length === 1
                ? intl.formatMessage(
                    {
                      id: 'lineage.header.outcomeSingle',
                      defaultMessage: 'Task outcome: {outcome}',
                    },
                    { outcome: outcomeLabel(o) }
                  )
                : intl.formatMessage(
                    {
                      id: 'lineage.header.outcomeCount',
                      defaultMessage: '{outcome} · {count}',
                    },
                    { outcome: outcomeLabel(o), count: outcomes[o] }
                  )}
            </Badge>
          ))}
        </div>
      </div>
      {impressions > 0 && voted === 0 ? (
        <Alert variant='warning' size='sm' role='status'>
          <Info aria-hidden />
          <AlertDescription>
            {intl.formatMessage({
              id: 'lineage.header.notReported',
              defaultMessage:
                "The agent didn't report which items helped, so usefulness can't be measured for this task.",
            })}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
