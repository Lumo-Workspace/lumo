'use client'

import Link from 'next/link'
import { useIntl } from 'react-intl'
import type { ApiMilestone } from '@/lib/api-client'

type RiskQueue = NonNullable<ApiMilestone['riskQueue']>

// Same compact token formatter as the cost section (LUM-560 convention) so
// the budget alert reads identically to the KPI card it summarizes.
const TOKEN_FMT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
function fmtTokens(n: number): string {
  return TOKEN_FMT.format(n)
}

const STATUS_LABEL_ID: Record<string, string> = {
  TODO: 'status.todo',
  IN_PROGRESS: 'status.inProgress',
  IN_REVIEW: 'status.inReview',
  DONE: 'status.done',
}

interface MilestoneRiskQueueSectionProps {
  riskQueue: ApiMilestone['riskQueue']
  /**
   * LUM-644 advisory burn-vs-budget block. Only `exceeded: true` surfaces
   * here (an advisory alert row — nothing is blocked); unknown/under-budget
   * states render nothing in this section.
   */
  budget?: ApiMilestone['budget']
  workspaceUrl: string
}

/**
 * LUM-638 risk & pending queue — the action-entry section: what is stuck
 * right now and who moves next. Every row links to the task (or its
 * boundary-crossings panel). Fail-closed by construction: an unreadable
 * crossings block renders as unknown (never 0), a fully clear queue
 * renders an explicit empty state (never hides the section), and the
 * scope-baseline line is value-neutral fact, not blame.
 */
export function MilestoneRiskQueueSection({
  riskQueue,
  budget,
  workspaceUrl,
}: MilestoneRiskQueueSectionProps) {
  const intl = useIntl()
  if (!riskQueue) return null
  const rq: RiskQueue = riskQueue
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values)
  const taskHref = (ref: string) => `/workspace/${workspaceUrl}/my-tasks/${ref}`
  // Unknown future statuses show raw rather than lying "Todo".
  const statusLabel = (s: string) => {
    const id = STATUS_LABEL_ID[s]
    return id ? t(id) : s
  }
  // Server-computed aging seconds → localized "2.4 天" / "8h" / "5 min"
  // (units are i18n keys; render stays pure — no Date.now here).
  const agingLabel = (sec: number): string => {
    if (sec >= 86400)
      return t('milestone.riskQueue.aging.days', {
        days: (sec / 86400).toFixed(1),
      })
    if (sec >= 3600)
      return t('milestone.riskQueue.aging.hours', {
        hours: Math.round(sec / 3600),
      })
    return t('milestone.riskQueue.aging.minutes', {
      minutes: Math.max(1, Math.round(sec / 60)),
    })
  }
  const crossingsTotal = rq.crossings.known
    ? rq.crossings.bySeverity.high +
      rq.crossings.bySeverity.medium +
      rq.crossings.bySeverity.low
    : 0
  // Advisory only: the alert exists solely when a MEASURED burn exceeds the
  // set budget — unknown (unmeasured) and no-budget states surface nothing.
  const budgetExceeded = budget?.exceeded === true ? budget : null
  const isEmpty =
    rq.blocked.length === 0 &&
    rq.awaitingVerdict.length === 0 &&
    rq.verifyEscalated.length === 0 &&
    rq.crossings.known &&
    crossingsTotal === 0 &&
    budgetExceeded === null

  const row = (
    key: string,
    href: string,
    ref: string,
    title: string,
    meta: React.ReactNode
  ) => (
    <Link
      key={key}
      href={href}
      className='grid grid-cols-[72px_1fr_auto_16px] items-baseline gap-3 px-3 py-2 hover:bg-muted'
    >
      <span className='font-mono text-xs text-muted-foreground'>{ref}</span>
      <span className='truncate text-[13.5px] font-medium'>{title}</span>
      <span className='whitespace-nowrap text-xs tabular-nums text-muted-foreground'>
        {meta}
      </span>
      <span
        aria-hidden='true'
        className='justify-self-end self-center text-xs text-muted-foreground'
      >
        ›
      </span>
    </Link>
  )

  const queue = (
    titleId: string,
    count: React.ReactNode,
    rows: React.ReactNode
  ) => (
    <div>
      <h3 className='mb-2 flex items-baseline gap-2 text-sm font-semibold'>
        {t(titleId)}
        <span className='text-xs font-normal tabular-nums text-muted-foreground'>
          {count}
        </span>
      </h3>
      <div className='divide-y divide-border rounded-lg border'>{rows}</div>
    </div>
  )

  const scopeLine = (
    <p className='mt-5 border-t pt-3.5 text-xs tabular-nums text-muted-foreground'>
      {rq.scopeBaseline.addedLater > 0
        ? t('milestone.riskQueue.scopeBaseline', {
            initial: rq.scopeBaseline.initial,
            current: rq.scopeBaseline.current,
            added: rq.scopeBaseline.addedLater,
          })
        : t('milestone.riskQueue.scopeBaselineNone', {
            initial: rq.scopeBaseline.initial,
            current: rq.scopeBaseline.current,
          })}
    </p>
  )

  return (
    <section className='mb-10' aria-label={t('milestone.riskQueue.title')}>
      <div className='mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1'>
        <h2 className='text-base font-bold'>
          {t('milestone.riskQueue.title')}
        </h2>
        <span className='text-xs text-muted-foreground'>
          {t('milestone.riskQueue.subtitle')}
        </span>
      </div>

      {isEmpty ? (
        <div className='rounded-lg border px-4 py-4 text-sm text-muted-foreground'>
          <p className='mb-0.5 font-semibold text-foreground'>
            {t('milestone.riskQueue.empty.title')}
          </p>
          {t('milestone.riskQueue.empty.body')}
        </div>
      ) : (
        <div className='flex flex-col gap-5'>
          {budgetExceeded && (
            <div data-testid='risk-queue-budget'>
              <h3 className='mb-2 flex items-baseline gap-2 text-sm font-semibold'>
                {t('milestone.riskQueue.budget.title')}
                <span className='text-xs font-normal tabular-nums text-muted-foreground'>
                  {t('milestone.riskQueue.budget.count', {
                    burn: fmtTokens(budgetExceeded.tokenCost ?? 0),
                    budget: fmtTokens(budgetExceeded.tokenBudget),
                    percent: Math.round((budgetExceeded.usedRatio ?? 0) * 100),
                  })}
                </span>
              </h3>
              <div className='rounded-lg border px-3 py-2.5 text-xs text-muted-foreground'>
                {t('milestone.riskQueue.budget.advisory')}
              </div>
            </div>
          )}

          {rq.blocked.length > 0 &&
            queue(
              'milestone.riskQueue.blocked.title',
              t('milestone.riskQueue.blocked.count', {
                count: rq.blocked.length,
              }),
              rq.blocked.map(b =>
                row(
                  `${b.taskId}-${b.blockingRef}`,
                  taskHref(b.ref),
                  b.ref,
                  b.title,
                  t('milestone.riskQueue.blocked.meta', {
                    ref: b.blockingRef,
                    status: statusLabel(b.blockingStatus),
                  })
                )
              )
            )}

          {rq.awaitingVerdict.length > 0 &&
            queue(
              'milestone.riskQueue.review.title',
              t('milestone.riskQueue.review.count', {
                count: rq.awaitingVerdict.length,
              }),
              rq.awaitingVerdict.map(a =>
                row(
                  a.taskId,
                  taskHref(a.ref),
                  a.ref,
                  a.title,
                  a.agingSec === null
                    ? t('milestone.riskQueue.review.agingUnknown')
                    : t('milestone.riskQueue.review.waiting', {
                        duration: agingLabel(a.agingSec),
                      })
                )
              )
            )}

          {rq.crossings.known ? (
            crossingsTotal > 0 &&
            queue(
              'milestone.riskQueue.crossings.title',
              t('milestone.riskQueue.crossings.count', {
                count: crossingsTotal,
                high: rq.crossings.bySeverity.high,
                medium: rq.crossings.bySeverity.medium,
                low: rq.crossings.bySeverity.low,
              }),
              rq.crossings.tasks.map(c =>
                row(
                  c.taskId,
                  `${taskHref(c.ref)}#boundary-crossings`,
                  c.ref,
                  c.title,
                  <>
                    {c.high > 0 && (
                      <em className='not-italic font-semibold text-foreground'>
                        {t('milestone.riskQueue.crossings.high', {
                          count: c.high,
                        })}{' '}
                        ·{' '}
                      </em>
                    )}
                    {c.medium > 0 &&
                      `${t('milestone.riskQueue.crossings.medium', { count: c.medium })} · `}
                    {c.low > 0 &&
                      `${t('milestone.riskQueue.crossings.low', { count: c.low })} · `}
                    {t('milestone.riskQueue.crossings.panel')}
                  </>
                )
              )
            )
          ) : (
            <div>
              <h3 className='mb-2 flex items-baseline gap-2 text-sm font-semibold'>
                {t('milestone.riskQueue.crossings.title')}
                <span className='text-xs font-normal text-muted-foreground'>
                  {t('milestone.riskQueue.crossings.unknownTitle')}
                </span>
              </h3>
              <div className='rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground'>
                {t('milestone.riskQueue.crossings.unknownBody')}
              </div>
            </div>
          )}

          {rq.verifyEscalated.length > 0 &&
            queue(
              'milestone.riskQueue.verify.title',
              t('milestone.riskQueue.verify.count', {
                count: rq.verifyEscalated.length,
              }),
              rq.verifyEscalated.map(v =>
                row(
                  v.taskId,
                  taskHref(v.ref),
                  v.ref,
                  v.title,
                  t('milestone.riskQueue.verify.meta', { round: v.round })
                )
              )
            )}
        </div>
      )}

      {scopeLine}
    </section>
  )
}
