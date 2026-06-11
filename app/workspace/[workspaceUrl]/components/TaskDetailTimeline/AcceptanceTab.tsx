'use client'

import { useIntl } from 'react-intl'
import { ClipboardCheck } from 'lucide-react'
import { useTaskStatus } from '../../hooks/useTaskStatus'
import type { TaskStatusCriterionView } from '../../types'
import { VerdictGlyph } from './items/AcceptanceBatchItem'

interface AcceptanceTabProps {
  taskIdentifier: string
  enabled: boolean
}

// Provenance pill styling — neutral, typography-led (no decorative color), with
// REVIEW_ADDED carrying a faint accent so review-time additions stay visible.
const SOURCE_PILL: Record<string, string> = {
  AGENT_DRAFT: 'border border-border text-muted-foreground',
  HUMAN_EDIT: 'border border-border text-muted-foreground',
  REVIEW_ADDED: 'bg-warning-subtle border border-warning-border text-foreground',
}

function isPass(verdict: string | undefined): boolean {
  return verdict === 'PASS' || verdict === 'PASS_WITH_FOLLOWUP'
}

function CriterionRow({ c }: { c: TaskStatusCriterionView }) {
  const intl = useIntl()
  const v = c.latestVerdict
  // A human override = a passing verdict authored by a HUMAN verifier — the red
  // line's "provable manual override", distinct from a machine PASS.
  const humanOverride = !!v && isPass(v.verdict) && v.verifierType === 'HUMAN'

  return (
    <div className='flex gap-2 px-3 py-2 border-t border-border/60 first:border-t-0'>
      <span className='translate-y-0.5'>
        <VerdictGlyph verdict={v?.verdict ?? ''} />
      </span>
      <div className='min-w-0 flex-1'>
        <div className='text-xs text-foreground'>{c.statement}</div>
        <div className='mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground'>
          <span className='rounded-sm bg-muted px-1 font-semibold uppercase'>
            {c.verifierType}
          </span>
          <span
            className={`rounded-sm px-1 font-medium ${SOURCE_PILL[c.source] ?? SOURCE_PILL.AGENT_DRAFT}`}
          >
            {c.source}
          </span>
          {humanOverride ? (
            <span className='rounded-sm bg-success-subtle border border-success-border px-1 font-medium text-foreground'>
              {intl.formatMessage({
                id: 'acceptance.tab.humanOverride',
                defaultMessage: 'human override',
              })}
            </span>
          ) : null}
          {v ? (
            <span>
              {intl.formatMessage(
                {
                  id: 'acceptance.tab.verdictRound',
                  defaultMessage: 'round {round}',
                },
                { round: v.round }
              )}
            </span>
          ) : (
            <span>
              {intl.formatMessage({
                id: 'acceptance.tab.unjudged',
                defaultMessage: 'not yet judged',
              })}
            </span>
          )}
        </div>
        {v?.evidencePointer ? (
          <div className='mt-0.5 text-[10px] text-foreground/50 break-all'>
            {v.evidencePointer}
          </div>
        ) : null}
        {v?.verdict === 'FAIL' && v.rejectionReason ? (
          <div className='mt-0.5 text-[10px] text-danger break-words'>
            {v.rejectionReason}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function AcceptanceTab({ taskIdentifier, enabled }: AcceptanceTabProps) {
  const intl = useIntl()
  const { data, loading, error } = useTaskStatus({
    identifier: taskIdentifier,
    enabled,
  })

  if (loading && !data) {
    return (
      <div className='py-8 text-center text-xs text-muted-foreground'>
        {intl.formatMessage({ id: 'acceptance.tab.loading', defaultMessage: '加载中…' })}
      </div>
    )
  }

  if (error) {
    return <div className='py-8 text-center text-xs text-danger'>{error}</div>
  }

  if (!data || data.criteria.length === 0) {
    return (
      <div className='py-12 flex flex-col items-center gap-2 text-muted-foreground'>
        <ClipboardCheck className='size-6' />
        <p className='text-xs'>
          {intl.formatMessage({
            id: 'acceptance.tab.empty',
            defaultMessage: '此任务暂无验收标准',
          })}
        </p>
      </div>
    )
  }

  const passed = data.criteria.filter(c => isPass(c.latestVerdict?.verdict)).length

  return (
    <div className='rounded-lg border border-border text-xs'>
      {/* Summary row: how many criteria met, current round / escalation. */}
      <div className='px-3 py-2 border-b border-border text-muted-foreground'>
        {intl.formatMessage(
          {
            id: 'acceptance.tab.summary',
            defaultMessage:
              '{passed}/{total} met · round {round}/{maxRounds}',
          },
          {
            passed,
            total: data.criteria.length,
            round: data.currentRound,
            maxRounds: data.maxRounds,
          }
        )}
        {data.escalated ? (
          <span className='ml-2 rounded-sm bg-danger-subtle border border-danger-border px-1 text-[10px] font-medium text-foreground'>
            {intl.formatMessage({
              id: 'acceptance.tab.escalated',
              defaultMessage: 'escalated to human',
            })}
          </span>
        ) : null}
      </div>

      {/* Contract: one row per criterion, with its latest verdict. */}
      <div>
        {data.criteria.map(c => (
          <CriterionRow key={c.id} c={c} />
        ))}
      </div>

      {/* Last round's failure reasons — why the most recent round bounced. */}
      {data.lastRoundFailures.length > 0 ? (
        <div className='border-t border-border px-3 py-2'>
          <div className='mb-1 font-medium text-foreground'>
            {intl.formatMessage({
              id: 'acceptance.tab.lastFailures',
              defaultMessage: 'Last round failures',
            })}
          </div>
          <ul className='space-y-0.5 text-[11px] text-muted-foreground'>
            {data.lastRoundFailures.map(f => (
              <li key={f.criterionId} className='break-words'>
                · {f.statement}
                {f.rejectionReason ? (
                  <span className='text-danger'> — {f.rejectionReason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* nextActions — the declarative "what's left" (unmet criteria). */}
      {data.nextActions.length > 0 ? (
        <div className='border-t border-border px-3 py-2'>
          <div className='mb-1 font-medium text-foreground'>
            {intl.formatMessage({
              id: 'acceptance.tab.nextActions',
              defaultMessage: 'Next actions',
            })}
          </div>
          <ul className='space-y-0.5 text-[11px] text-muted-foreground'>
            {data.nextActions.map(a => (
              <li key={a.criterionId} className='break-words'>
                · [{a.verifierType}] {a.statement}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
