'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import {
  SESSION_RECORD_CHOICES,
  USED_UP_GRACE_DAYS,
  USED_UP_IDLE_DAYS,
  sessionRecordChoiceOf,
  sessionRecordChoiceShortens,
  sessionRecordSettingFor,
  type SessionRecordChoice,
} from '@/lib/hook-event/retention'
import { RetentionRow } from './RetentionRow'
import { useRetentionSave } from './useRetentionSave'

interface SessionRecordRetentionRowProps {
  /** Stored `hookEventRetentionMode` (RETAIN | USED_UP). */
  initialMode: string | null
  /** Stored `hookEventRetentionDays`; null = forever. */
  initialDays: number | null
}

function parseChoice(value: string): SessionRecordChoice {
  if (value === 'forever' || value === 'used_up') return value
  return sessionRecordChoiceOf('RETAIN', Number(value))
}

/**
 * LUM-933 / LUM-910 — the session record (raw hook events) row: keep forever
 * (default), 30 / 90 / 180 / 365 days, or discard when used up.
 */
export function SessionRecordRetentionRow({
  initialMode,
  initialDays,
}: SessionRecordRetentionRowProps) {
  const intl = useIntl()
  const [saved, setSaved] = useState<SessionRecordChoice>(() =>
    sessionRecordChoiceOf(initialMode, initialDays)
  )
  const [choice, setChoice] = useState<SessionRecordChoice>(saved)
  const { saving, save } = useRetentionSave()

  const label = (c: SessionRecordChoice) => {
    if (c === 'forever')
      return intl.formatMessage({ id: 'dataRetention.session.forever' })
    if (c === 'used_up')
      return intl.formatMessage({ id: 'dataRetention.session.usedUp' })
    return intl.formatMessage({ id: 'dataRetention.session.days' }, { days: c })
  }

  const hint =
    choice === 'used_up'
      ? intl.formatMessage(
          { id: 'dataRetention.session.usedUpHint' },
          { grace: USED_UP_GRACE_DAYS, idle: USED_UP_IDLE_DAYS }
        )
      : choice === 'forever'
        ? intl.formatMessage({ id: 'dataRetention.session.foreverHint' })
        : intl.formatMessage(
            { id: 'dataRetention.session.daysHint' },
            { days: choice }
          )

  const handleSave = async () => {
    const setting = sessionRecordSettingFor(choice)
    const ok = await save({
      hookEventRetentionMode: setting.mode,
      hookEventRetentionDays: setting.days,
    })
    if (ok) setSaved(choice)
  }

  return (
    <RetentionRow
      id='session-record'
      label={intl.formatMessage({ id: 'dataRetention.session.label' })}
      description={intl.formatMessage({
        id: 'dataRetention.session.description',
      })}
      notes={
        <p
          data-testid='retention-hint-session-record'
          className='text-caption text-muted-foreground mt-1'
        >
          {hint}
        </p>
      }
      options={SESSION_RECORD_CHOICES.map(c => ({
        value: String(c),
        label: label(c),
      }))}
      value={String(choice)}
      onChange={v => setChoice(parseChoice(v))}
      warning={
        sessionRecordChoiceShortens(saved, choice)
          ? intl.formatMessage({ id: 'dataRetention.session.tightenNote' })
          : null
      }
      dirty={choice !== saved}
      saving={saving}
      onSave={handleSave}
    />
  )
}
