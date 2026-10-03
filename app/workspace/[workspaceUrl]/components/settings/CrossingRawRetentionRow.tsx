'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import {
  CROSSING_RAW_RETENTION_DAYS,
  DEFAULT_CROSSING_RAW_RETENTION_DAYS,
  isCrossingRawRetentionDays,
  type CrossingRawRetentionDays,
} from '@/lib/boundary-crossing/raw-retention'
import { RetentionRow } from './RetentionRow'
import { useRetentionSave } from './useRetentionSave'

interface CrossingRawRetentionRowProps {
  /** The stored `crossingRawRetentionDays`. */
  initialDays: number | null
}

/**
 * LUM-912 — how long a dispositioned boundary crossing keeps its original
 * command, diff line and explanations (7 / 30 / 90 days, default 7).
 */
export function CrossingRawRetentionRow({
  initialDays,
}: CrossingRawRetentionRowProps) {
  const intl = useIntl()
  const [saved, setSaved] = useState<CrossingRawRetentionDays>(
    isCrossingRawRetentionDays(initialDays)
      ? initialDays
      : DEFAULT_CROSSING_RAW_RETENTION_DAYS
  )
  const [days, setDays] = useState<CrossingRawRetentionDays>(saved)
  const { saving, save } = useRetentionSave()

  const handleSave = async () => {
    if (await save({ crossingRawRetentionDays: days })) setSaved(days)
  }

  return (
    <RetentionRow
      id='crossing-raw'
      label={intl.formatMessage({ id: 'dataRetention.crossing.label' })}
      description={intl.formatMessage({
        id: 'dataRetention.crossing.description',
      })}
      options={CROSSING_RAW_RETENTION_DAYS.map(d => ({
        value: String(d),
        label: intl.formatMessage(
          {
            id:
              d === DEFAULT_CROSSING_RAW_RETENTION_DAYS
                ? 'dataRetention.crossing.daysDefault'
                : 'dataRetention.crossing.days',
          },
          { days: d }
        ),
      }))}
      value={String(days)}
      onChange={v => {
        const next = Number(v)
        if (isCrossingRawRetentionDays(next)) setDays(next)
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
