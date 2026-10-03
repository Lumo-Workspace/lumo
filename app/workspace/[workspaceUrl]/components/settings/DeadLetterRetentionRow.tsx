'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import {
  DEAD_LETTER_PAYLOAD_RETENTION_DAYS,
  DEAD_LETTER_RETENTION_DAYS,
  isDeadLetterRetentionDays,
  type DeadLetterRetentionDays,
} from '@/lib/integrations/github/dead-letter-retention'
import { RetentionRow } from './RetentionRow'
import { useRetentionSave } from './useRetentionSave'

interface DeadLetterRetentionRowProps {
  /** The stored `deadLetterRetentionDays`. */
  initialDays: number | null
}

/**
 * LUM-941 — how long a PR comment sync that failed for good keeps the GitHub
 * webhook payload (7 / 30 / 90 days, default 7 = the LUM-913 behaviour).
 */
export function DeadLetterRetentionRow({
  initialDays,
}: DeadLetterRetentionRowProps) {
  const intl = useIntl()
  const [saved, setSaved] = useState<DeadLetterRetentionDays>(
    isDeadLetterRetentionDays(initialDays)
      ? initialDays
      : DEAD_LETTER_PAYLOAD_RETENTION_DAYS
  )
  const [days, setDays] = useState<DeadLetterRetentionDays>(saved)
  const { saving, save } = useRetentionSave()

  const handleSave = async () => {
    if (await save({ deadLetterRetentionDays: days })) setSaved(days)
  }

  return (
    <RetentionRow
      id='dead-letter'
      label={intl.formatMessage({ id: 'dataRetention.deadLetter.label' })}
      description={intl.formatMessage({
        id: 'dataRetention.deadLetter.description',
      })}
      options={DEAD_LETTER_RETENTION_DAYS.map(d => ({
        value: String(d),
        label: intl.formatMessage(
          {
            id:
              d === DEAD_LETTER_PAYLOAD_RETENTION_DAYS
                ? 'dataRetention.deadLetter.daysDefault'
                : 'dataRetention.deadLetter.days',
          },
          { days: d }
        ),
      }))}
      value={String(days)}
      onChange={v => {
        const next = Number(v)
        if (isDeadLetterRetentionDays(next)) setDays(next)
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
