'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { tasksClient } from '@/lib/api-client'

/** Mirrors VerificationRejectionReason — the human picks one on a FAIL. */
const REJECTION_REASONS = [
  'CRITERION_UNMET',
  'EVIDENCE_INSUFFICIENT',
  'CHECK_EXECUTION_ERROR',
  'SCOPE_MISMATCH',
  'OTHER',
] as const

type HumanVerdict = 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP'

export interface HumanVerdictResult {
  taskStatus: string
  verdict: HumanVerdict
  followUpTask: { id: string; number: number; title: string } | null
}

interface TaskVerdictBarProps {
  taskId: string
  /** Current task status — the bar only renders for IN_REVIEW. */
  status: string
  onVerdictRecorded: (result: HumanVerdictResult) => void
}

/**
 * Minimal three-state human adjudication bar (LUM-421, Slice 2 data half).
 * Renders only while the task is IN_REVIEW — the human-initiated entry point
 * to the human-verdict write path (milestone rule 5: agents/CLI can never
 * reach it; the server refuses bearer identities). FAIL and
 * PASS_WITH_FOLLOWUP expand an inline panel instead of a modal: FAIL requires
 * a rejection reason, PASS_WITH_FOLLOWUP takes the outstanding items that
 * seed the auto-created follow-up task.
 */
export function TaskVerdictBar({
  taskId,
  status,
  onVerdictRecorded,
}: TaskVerdictBarProps) {
  const intl = useIntl()
  const [panel, setPanel] = useState<'FAIL' | 'PASS_WITH_FOLLOWUP' | null>(null)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)

  if (status !== 'IN_REVIEW') return null

  const submit = async (verdict: HumanVerdict) => {
    setSubmitting(true)
    setFailed(false)
    try {
      const trimmed = note.trim()
      const result = await tasksClient.submitHumanVerdict<HumanVerdictResult>(
        taskId,
        {
          verdict,
          ...(verdict === 'FAIL' ? { rejectionReasonEnum: reason } : {}),
          ...(verdict !== 'PASS' && trimmed ? { note: trimmed } : {}),
        }
      )
      onVerdictRecorded(result)
    } catch {
      setFailed(true)
    } finally {
      setSubmitting(false)
    }
  }

  const openPanel = (next: 'FAIL' | 'PASS_WITH_FOLLOWUP') => {
    setPanel(prev => (prev === next ? null : next))
    setFailed(false)
  }

  return (
    <div
      data-testid='task-verdict-bar'
      className='mb-6 rounded-md border border-border px-4 py-3'
    >
      <div className='flex flex-wrap items-center gap-3'>
        <div className='flex-1 min-w-48'>
          <p className='text-body font-semibold text-foreground'>
            {intl.formatMessage({ id: 'task.verdict.title' })}
          </p>
          <p className='text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'task.verdict.hint' })}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Button
            size='sm'
            data-testid='verdict-pass'
            disabled={submitting}
            onClick={() => submit('PASS')}
          >
            {intl.formatMessage({ id: 'task.verdict.pass' })}
          </Button>
          <Button
            size='sm'
            variant='outline'
            data-testid='verdict-followup'
            disabled={submitting}
            onClick={() => openPanel('PASS_WITH_FOLLOWUP')}
          >
            {intl.formatMessage({ id: 'task.verdict.passWithFollowUp' })}
          </Button>
          <Button
            size='sm'
            variant='outline'
            data-testid='verdict-fail'
            disabled={submitting}
            onClick={() => openPanel('FAIL')}
          >
            {intl.formatMessage({ id: 'task.verdict.fail' })}
          </Button>
        </div>
      </div>

      {panel !== null && (
        <div className='mt-3 space-y-2 border-t border-border pt-3'>
          {panel === 'FAIL' && (
            <div>
              <label
                htmlFor='verdict-reason'
                className='block text-caption font-medium text-muted-foreground mb-1'
              >
                {intl.formatMessage({ id: 'task.verdict.reasonLabel' })}
              </label>
              <select
                id='verdict-reason'
                data-testid='verdict-reason-select'
                value={reason}
                onChange={e => setReason(e.target.value)}
                className='w-full h-control-sm rounded-md border border-input bg-background px-2 text-body'
              >
                <option value=''>
                  {intl.formatMessage({ id: 'task.verdict.reasonPlaceholder' })}
                </option>
                {REJECTION_REASONS.map(r => (
                  <option key={r} value={r}>
                    {intl.formatMessage({ id: `task.verdict.reason.${r}` })}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label
              htmlFor='verdict-note'
              className='block text-caption font-medium text-muted-foreground mb-1'
            >
              {intl.formatMessage({
                id:
                  panel === 'FAIL'
                    ? 'task.verdict.noteLabel'
                    : 'task.verdict.followUpNoteLabel',
              })}
            </label>
            <Textarea
              id='verdict-note'
              data-testid='verdict-note'
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={intl.formatMessage({
                id:
                  panel === 'FAIL'
                    ? 'task.verdict.notePlaceholder'
                    : 'task.verdict.followUpNotePlaceholder',
              })}
              rows={2}
            />
          </div>
          <div className='flex items-center gap-2'>
            <Button
              size='sm'
              variant={panel === 'FAIL' ? 'destructive' : 'default'}
              data-testid='verdict-confirm'
              disabled={submitting || (panel === 'FAIL' && reason === '')}
              onClick={() => submit(panel)}
            >
              {intl.formatMessage({ id: 'task.verdict.confirm' })}
            </Button>
            <Button
              size='sm'
              variant='ghost'
              disabled={submitting}
              onClick={() => setPanel(null)}
            >
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
          </div>
        </div>
      )}

      {failed && (
        <p
          data-testid='verdict-error'
          className='mt-2 text-caption text-danger'
        >
          {intl.formatMessage({ id: 'task.verdict.error' })}
        </p>
      )}
    </div>
  )
}
