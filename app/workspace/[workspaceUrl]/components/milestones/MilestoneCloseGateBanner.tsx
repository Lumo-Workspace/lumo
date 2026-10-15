'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { MilestoneCloseGateView } from '@/lib/api-client/test-cases'

interface MilestoneCloseGateBannerProps {
  gate: MilestoneCloseGateView
  /** Every task in the milestone is DONE — the only time an override means anything. */
  allTasksDone: boolean
  completed: boolean
  onOverride: (note: string) => Promise<void>
}

const REASON_ID = {
  NOT_RUN: 'milestoneGate.reason.notRun',
  PROVEN_DEFECT: 'milestoneGate.reason.provenDefect',
  FAILING: 'milestoneGate.reason.failing',
  BLOCKED: 'milestoneGate.reason.blocked',
} as const

/**
 * LUM-1135: why the milestone has not closed, and the human escape hatch.
 * Pure render + callback — the request lives in the parent (SRP).
 */
export function MilestoneCloseGateBanner({
  gate,
  allTasksDone,
  completed,
  onOverride,
}: MilestoneCloseGateBannerProps) {
  const intl = useIntl()
  const [overriding, setOverriding] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  if (gate.held === 0) {
    return (
      <p className='text-body text-muted-foreground'>
        {intl.formatMessage({ id: 'milestoneGate.open' })}
      </p>
    )
  }
  const held = gate.cases.filter(c => c.state === 'held')

  async function confirm() {
    setBusy(true)
    setFailed(false)
    try {
      await onOverride(note.trim())
      setOverriding(false)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role='status'
      className='rounded-md border border-border p-3 text-body'
    >
      <p className='text-body-strong text-foreground'>
        {intl.formatMessage({ id: 'milestoneGate.held' }, { count: gate.held })}
      </p>
      <ul className='mt-2 space-y-1'>
        {held.map(c => (
          <li key={c.number}>
            <span className='font-mono'>TC{c.number}</span> {c.title} —{' '}
            {c.reason ? intl.formatMessage({ id: REASON_ID[c.reason] }) : null}
          </li>
        ))}
      </ul>
      {allTasksDone && !completed && !overriding && (
        <Button
          variant='outline'
          size='sm'
          className='mt-3'
          onClick={() => {
            // A fresh attempt starts without the previous attempt's error.
            setFailed(false)
            setOverriding(true)
          }}
        >
          {intl.formatMessage({ id: 'milestoneGate.override.open' })}
        </Button>
      )}
      {overriding && (
        <div className='mt-3 space-y-2'>
          <Textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={intl.formatMessage({
              id: 'milestoneGate.override.notePlaceholder',
            })}
          />
          {failed ? (
            <p role='alert' className='text-body text-danger-text'>
              {intl.formatMessage({ id: 'milestoneGate.override.failed' })}
            </p>
          ) : null}
          <div className='flex gap-2'>
            <Button
              size='sm'
              disabled={note.trim().length === 0 || busy}
              onClick={() => void confirm()}
            >
              {intl.formatMessage({ id: 'milestoneGate.override.confirm' })}
            </Button>
            <Button
              size='sm'
              variant='ghost'
              onClick={() => {
                setOverriding(false)
                setFailed(false)
              }}
            >
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
