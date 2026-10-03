'use client'

import { useIntl } from 'react-intl'
import { Sparkles } from 'lucide-react'
import { TRIAGE_THRESHOLD } from '@/lib/boundary-crossing/triage-threshold'

/** LUM-945: how the AI triage scored this crossing. */
export interface CrossingTriageLineProps {
  crossingId: string
  probability: number
  /** The crossing's current disposition; null = still open. */
  disposition: string | null
}

export function CrossingTriageLine({
  crossingId,
  probability,
  disposition,
}: CrossingTriageLineProps) {
  const intl = useIntl()
  const values = {
    probability: intl.formatNumber(probability, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    threshold: intl.formatNumber(TRIAGE_THRESHOLD, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  }
  const text =
    disposition === 'AUTO_LEGIT'
      ? intl.formatMessage(
          {
            id: 'boundary.panel.triageAutoCleared',
            defaultMessage:
              'Auto-cleared by AI triage: P(legit) {probability}, at or above the {threshold} threshold. Rule it confirmed if it was a real crossing.',
          },
          values
        )
      : disposition === null
        ? intl.formatMessage(
            {
              id: 'boundary.panel.triageBelow',
              defaultMessage:
                'AI triage: P(legit) {probability}, below the {threshold} threshold — a human rules on this one.',
            },
            values
          )
        : intl.formatMessage(
            {
              id: 'boundary.panel.triageScore',
              defaultMessage: 'AI triage scored P(legit) {probability}.',
            },
            values
          )
  return (
    <p
      data-testid={`boundary-triage-${crossingId}`}
      className='mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground'
    >
      <Sparkles className='mt-0.5 size-3.5 shrink-0' aria-hidden />
      <span>{text}</span>
    </p>
  )
}
