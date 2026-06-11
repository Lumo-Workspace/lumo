'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { ShieldAlert, Lock, Check } from 'lucide-react'
import { tasksClient } from '@/lib/api-client'
import { useBoundaryCrossings } from '../../hooks/useBoundaryCrossings'
import { boundaryCategoryLabel } from './boundary-format'

interface BoundaryCrossingsPanelProps {
  taskIdentifier: string
  enabled: boolean
  /** Refresh the acceptance banner after an acknowledgement clears the gate. */
  onAcknowledged?: () => void
}

/**
 * AcceptanceTab panel listing a task's open (unacknowledged) forbidden-action
 * boundary-crossings (LUM-426, criterion 6). Renders nothing when none are
 * open — a clean task never sees it. Each row says which action, why it was
 * flagged, and offers the human-only Acknowledge that clears the DONE block.
 */
export function BoundaryCrossingsPanel({
  taskIdentifier,
  enabled,
  onAcknowledged,
}: BoundaryCrossingsPanelProps) {
  const intl = useIntl()
  const { crossings, refresh } = useBoundaryCrossings({
    identifier: taskIdentifier,
    enabled,
  })
  const [pending, setPending] = useState<string | null>(null)

  if (crossings.length === 0) return null

  const acknowledge = (crossingId: string) => {
    setPending(crossingId)
    void tasksClient
      .acknowledgeBoundaryCrossing(taskIdentifier, crossingId)
      .then(() => {
        void refresh()
        onAcknowledged?.()
      })
      .finally(() => setPending(null))
  }

  return (
    <div className='rounded-lg border border-warning-border bg-warning-subtle/40 p-3.5'>
      <div className='mb-2 flex items-center gap-2'>
        <ShieldAlert className='size-4 shrink-0 text-warning' aria-hidden />
        <span className='text-sm font-medium text-foreground'>
          {intl.formatMessage({
            id: 'boundary.panel.title',
            defaultMessage: 'Boundary crossings',
          })}
        </span>
        <span className='rounded-md bg-warning-subtle px-2 py-0.5 text-[11px] font-medium text-warning'>
          {intl.formatMessage(
            {
              id: 'boundary.panel.openCount',
              defaultMessage: '{count, plural, one {# open} other {# open}}',
            },
            { count: crossings.length }
          )}
        </span>
      </div>

      <p className='mb-3 flex items-start gap-1.5 text-xs text-muted-foreground'>
        <Lock className='mt-0.5 size-3.5 shrink-0' aria-hidden />
        <span>
          {intl.formatMessage({
            id: 'boundary.panel.blockedNote',
            defaultMessage:
              "This task can't move to Done until each crossing below is acknowledged by a human. The gate is on for this workspace.",
          })}
        </span>
      </p>

      <div className='space-y-2'>
        {crossings.map(c => (
          <div
            key={c.id}
            className='rounded-md border border-border bg-background px-3 py-2.5'
          >
            <div className='flex items-start justify-between gap-3'>
              <div className='min-w-0'>
                <div className='text-[13px] font-medium text-foreground'>
                  {boundaryCategoryLabel(c.category, intl)}
                </div>
                <div className='mt-0.5 text-[11px] text-muted-foreground'>
                  {intl.formatMessage({
                    id: 'boundary.panel.why',
                    defaultMessage:
                      "Why: this action is on the project's Forbidden list.",
                  })}
                </div>
                <code className='mt-1.5 block overflow-x-auto whitespace-nowrap rounded-md bg-muted/60 px-2 py-1 font-mono text-[11px] text-foreground'>
                  {c.detail}
                </code>
                <div className='mt-1.5 text-[11px] text-muted-foreground/80'>
                  {intl.formatMessage({
                    id: 'boundary.panel.detected',
                    defaultMessage: 'Detected from a tool event',
                  })}{' '}
                  · {new Date(c.detectedAt).toLocaleString(intl.locale)}
                </div>
              </div>
              <button
                type='button'
                data-testid={`boundary-ack-${c.id}`}
                disabled={pending === c.id}
                onClick={() => acknowledge(c.id)}
                className='inline-flex shrink-0 items-center gap-1 rounded-sm border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50'
              >
                <Check className='size-3.5' aria-hidden />
                {intl.formatMessage({
                  id: 'boundary.panel.acknowledge',
                  defaultMessage: 'Acknowledge',
                })}
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className='mt-3 text-[11px] text-muted-foreground/80'>
        {intl.formatMessage({
          id: 'boundary.panel.humanOnly',
          defaultMessage:
            'Acknowledging records who signed off and unblocks Done. Only a signed-in human can acknowledge — the agent/CLI path is closed by design.',
        })}
      </p>
    </div>
  )
}
