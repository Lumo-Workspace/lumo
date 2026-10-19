'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { RetentionRow } from './RetentionRow'
import { useRetentionSave } from './useRetentionSave'

type Choice = 'on' | 'off'

interface AiDerivedContentRowProps {
  /** The stored `aiDerivedContentEnabled`; null (not loaded) reads as on. */
  initialEnabled: boolean | null
}

/**
 * LUM-917 — the switch for AI-derived content: memories extracted from
 * sessions, session summaries and run summaries. On by default; off stops new
 * generation and leaves what is stored to the delete row below.
 */
export function AiDerivedContentRow({
  initialEnabled,
}: AiDerivedContentRowProps) {
  const intl = useIntl()
  const [saved, setSaved] = useState<Choice>(
    initialEnabled === false ? 'off' : 'on'
  )
  const [choice, setChoice] = useState<Choice>(saved)
  const { saving, save } = useRetentionSave()

  const handleSave = async () => {
    if (await save({ aiDerivedContentEnabled: choice === 'on' })) {
      setSaved(choice)
    }
  }

  return (
    <RetentionRow
      id='ai-derived'
      label={intl.formatMessage({ id: 'dataRetention.aiDerived.label' })}
      description={intl.formatMessage({
        id: 'dataRetention.aiDerived.description',
      })}
      notes={
        <p
          data-testid='retention-hint-ai-derived'
          className='text-caption text-muted-foreground mt-1'
        >
          {intl.formatMessage({ id: 'dataRetention.aiDerived.offImpact' })}
        </p>
      }
      options={[
        {
          value: 'on',
          label: intl.formatMessage({ id: 'dataRetention.aiDerived.on' }),
        },
        {
          value: 'off',
          label: intl.formatMessage({ id: 'dataRetention.aiDerived.off' }),
        },
      ]}
      value={choice}
      onChange={v => setChoice(v === 'off' ? 'off' : 'on')}
      warning={
        saved === 'on' && choice === 'off'
          ? intl.formatMessage({ id: 'dataRetention.aiDerived.offWarning' })
          : null
      }
      saving={saving}
      onSave={handleSave}
    />
  )
}
