'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronRight } from 'lucide-react'
import type { AgentRunMemberStat, ModelCost } from '../../types'
import { IN_FLIGHT_MODEL } from '@/types/model-cost'
import { TokenCostBreakdown } from '../TokenCostBreakdown'
import { PerMemberSummary } from './PerMemberSummary'
import { summarizePerMember } from './summarize-per-member'
import { fmtCompact, modelLabel } from './model-cost-format'

interface TokenUsageBreakdownProps {
  totals: {
    runCount: number
    turnCount: number
    loopCount: number
    byModel: ModelCost[]
  }
  perMember: AgentRunMemberStat[]
}

/** Collapsible Token-usage card body. Lives inside the delivery card now, so it
 *  carries no border chrome of its own — the parent supplies the divider. */
export function TokenUsageBreakdown({
  totals,
  perMember,
}: TokenUsageBreakdownProps) {
  const intl = useIntl()
  // Collapsed by default (LUM-351) — the header row already carries per-model
  // totals, and live burn has its own header in the delivery card above.
  const [costOpen, setCostOpen] = useState(false)

  const hasInFlight = totals.byModel.some(
    m => m.inFlight || m.model === IN_FLIGHT_MODEL
  )
  const modelSummary = totals.byModel
    .map(m => `${modelLabel(intl, m.model)} ${fmtCompact(intl, m.total)}`)
    .join(' · ')
  const memberRows = summarizePerMember(perMember)

  return (
    <div>
      <button
        type='button'
        onClick={() => setCostOpen(v => !v)}
        aria-expanded={costOpen}
        data-testid='token-usage-toggle'
        className='flex w-full items-center gap-3 rounded-lg px-1 py-1 text-caption transition-colors hover:bg-muted/60'
      >
        <ChevronRight
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${costOpen ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <span className='flex min-h-5 shrink-0 items-center font-medium'>
          {intl.formatMessage({
            id: 'tokenCost.label',
            defaultMessage: 'Token usage',
          })}
        </span>
        <span className='shrink-0 text-muted-foreground'>
          {intl.formatMessage(
            {
              id: 'agentRun.summary',
              defaultMessage:
                '{runs, plural, one {# run} other {# runs}} · {turns, plural, one {# turn} other {# turns}} · {models, plural, one {# model} other {# models}}',
            },
            {
              runs: totals.runCount,
              turns: totals.turnCount,
              models: totals.byModel.length,
            }
          )}
        </span>
        {!costOpen && (
          <span className='ml-auto flex min-w-0 items-center gap-2 text-muted-foreground'>
            {hasInFlight && (
              <>
                <span
                  data-testid='collapsed-in-flight-dot'
                  className='size-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/60'
                  aria-hidden
                />
                <span className='sr-only'>
                  {intl.formatMessage({
                    id: 'tokenCost.inFlight',
                    defaultMessage: 'in progress',
                  })}
                </span>
              </>
            )}
            <span className='truncate tabular-nums'>{modelSummary}</span>
          </span>
        )}
      </button>
      {costOpen && (
        <div className='mt-1'>
          <PerMemberSummary rows={memberRows} />
          <TokenCostBreakdown
            variant='full'
            showTitle={false}
            models={totals.byModel}
            loopCount={totals.loopCount}
            perMember={perMember}
          />
        </div>
      )}
    </div>
  )
}
