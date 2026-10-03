'use client'

import { useIntl } from 'react-intl'
import type { StruggleTrailView, TrendModelView } from '../../types'
import { InfoTooltip } from './InfoTooltip'

/**
 * The honest-report sections (LUM-566) — the web render of what LUM-559~564 put
 * into `lumo task status --full`: the struggle / rework trail (561) and the
 * trend (562). (The claim-vs-verification pairing and the faithfulness verdict
 * were retired from the front-end in LUM-733; the cost read-out (560) became
 * the Record tab's Run report KPI tiles in LUM-496 — see `RunReportTiles`.) All
 * read the same GET /api/tasks/[id]/status read model the CLI prints, so the two
 * surfaces are same-source and cannot drift. Every section is fail-closed: a
 * not-measured value states its absence rather than implying a clean zero, and
 * the struggle trail renders even on a 0-unmet task so a clean report never wipes
 * the scars. Hierarchy is carried by type weight + spacing, reusing the existing
 * muted/foreground/feedback tokens — no new accent color budget.
 */

// Mirror the CLI's compact token formatter (notation:'compact',
// maximumFractionDigits:1) so the same number reads identically in both surfaces.
const TOKEN_FMT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
// Exported so RunReportTiles.tsx (LUM-496 Task 4) reuses the same formatter
// for its "COST 1.4B tokens" tile instead of forking a second one.
export function fmtTokens(n: number): string {
  return TOKEN_FMT.format(n)
}

function SectionTitle({
  children,
  tip,
}: {
  children: React.ReactNode
  tip?: string
}) {
  return (
    <div className='mb-2 flex items-center gap-1 text-body-strong text-foreground'>
      {children}
      {tip ? <InfoTooltip label={tip} /> : null}
    </div>
  )
}

// ── LUM-561 · Struggle / rework / outstanding ─────────────────────────────────

/** LUM-496: the struggle trail's heading + tip, exported so the Record tab's
 *  collapsed disclosure can label itself with exactly this copy (and render the
 *  section `headless` inside) instead of forking a second wording. */
export const STRUGGLE_TITLE = {
  id: 'acceptance.struggle.title',
  defaultMessage: 'Struggle / rework / outstanding',
} as const
export const STRUGGLE_TIP = {
  id: 'acceptance.struggle.tip',
  defaultMessage:
    'The rework a clean report would otherwise hide: multiple PR cycles and review/done reopens. Always shown — an empty trail states its basis instead of disappearing.',
} as const

export function StruggleTrailSection({
  trail,
  headless = false,
}: {
  trail: StruggleTrailView
  /** LUM-496: the Record tab wraps this section in a disclosure that already
   *  carries the heading — suppress the in-section one so the title is not
   *  printed twice. */
  headless?: boolean
}) {
  const intl = useIntl()
  const prIterated = trail.pullRequests.length > 1
  const empty = trail.reopens.length === 0 && !prIterated

  return (
    <div>
      {headless ? null : (
        <SectionTitle tip={intl.formatMessage(STRUGGLE_TIP)}>
          {intl.formatMessage(STRUGGLE_TITLE)}
        </SectionTitle>
      )}

      {empty ? (
        <p className='rounded-md border border-border px-3 py-2.5 text-[12px] leading-snug text-muted-foreground'>
          {intl.formatMessage({
            id: 'acceptance.struggle.noneRecorded',
            defaultMessage: 'None recorded — a single PR cycle, no reopens.',
          })}
        </p>
      ) : (
        <div className='space-y-2 rounded-md border border-border px-3 py-2.5 text-[12px] leading-snug'>
          {prIterated ? (
            <p className='text-muted-foreground'>
              <span className='font-medium text-foreground'>
                {intl.formatMessage({
                  id: 'acceptance.struggle.prIterations',
                  defaultMessage: 'PR iterations: ',
                })}
              </span>
              {intl.formatMessage(
                {
                  id: 'acceptance.struggle.prCount',
                  defaultMessage: '{count} PRs ({nums})',
                },
                {
                  count: trail.pullRequests.length,
                  nums: trail.pullRequests
                    .slice(0, 12)
                    .map(p => `#${p.number}`)
                    .join(', '),
                }
              )}
            </p>
          ) : null}

          {trail.reopens.length > 0 ? (
            <div>
              <p className='font-medium text-foreground'>
                {intl.formatMessage(
                  {
                    id: 'acceptance.struggle.reopened',
                    defaultMessage:
                      'Reopened {count}× (bounced back after review/done)',
                  },
                  { count: trail.reopens.length }
                )}
              </p>
              <ul className='mt-0.5 space-y-0.5'>
                {trail.reopens.map((r, i) => (
                  <li key={i} className='text-muted-foreground'>
                    {r.from} → {r.to}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

// ── LUM-562 · Trend ───────────────────────────────────────────────────────────

function arrow(delta: number): string {
  return delta > 0 ? '↑' : delta < 0 ? '↓' : '→'
}

export function TrendSection({ trend }: { trend: TrendModelView }) {
  const intl = useIntl()
  const cost = trend.cost
  const rw = trend.rework
  const title = intl.formatMessage({
    id: 'acceptance.trend.title',
    defaultMessage: 'Trend',
  })
  const tip = intl.formatMessage({
    id: 'acceptance.trend.tip',
    defaultMessage:
      'Movement across attempts — cost per session and rework accrual — not a single-point snapshot. A single attempt says so rather than drawing a fake trend.',
  })

  // Nothing to trend, or a single point — say so plainly (no fake arrow).
  if (cost.length === 0) {
    return (
      <div>
        <SectionTitle tip={tip}>{title}</SectionTitle>
        <p className='rounded-md border border-border px-3 py-2.5 text-[12px] text-muted-foreground'>
          {intl.formatMessage({
            id: 'acceptance.trend.nothing',
            defaultMessage: 'No measured cost yet — nothing to trend.',
          })}
        </p>
      </div>
    )
  }

  if (cost.length < 2) {
    const bits: string[] = []
    if (cost[0])
      bits.push(
        intl.formatMessage(
          {
            id: 'acceptance.trend.bitCost',
            defaultMessage: 'cost {tokens} tokens',
          },
          { tokens: fmtTokens(cost[0].total) }
        )
      )
    bits.push(
      rw.total === 0
        ? intl.formatMessage({
            id: 'acceptance.trend.bitReworkNone',
            defaultMessage: 'rework none',
          })
        : intl.formatMessage(
            {
              id: 'acceptance.trend.bitRework',
              defaultMessage: 'rework {total}',
            },
            { total: rw.total }
          )
    )
    return (
      <div>
        <SectionTitle tip={tip}>{title}</SectionTitle>
        <div className='space-y-0.5 rounded-md border border-border px-3 py-2.5 text-[12px] text-muted-foreground'>
          <p>
            {intl.formatMessage({
              id: 'acceptance.trend.singlePoint',
              defaultMessage:
                'Single attempt so far — no trajectory yet (a trend needs ≥2 sessions).',
            })}
          </p>
          <p className='text-foreground'>{bits.join(' · ')}</p>
        </div>
      </div>
    )
  }

  const costFirst = cost[0]?.total ?? 0
  const costLast = cost[cost.length - 1]?.total ?? 0
  const costTotal = cost.reduce((a, c) => a + c.total, 0)

  return (
    <div>
      <SectionTitle tip={tip}>{title}</SectionTitle>
      <div className='space-y-1 rounded-md border border-border px-3 py-2.5 text-[12px] leading-snug'>
        {cost.length >= 2 ? (
          <p>
            <span className='font-medium text-foreground'>
              {intl.formatMessage({
                id: 'acceptance.trend.costPerSession',
                defaultMessage: 'Cost/session: ',
              })}
            </span>
            <span className='text-muted-foreground'>
              {fmtTokens(costFirst)} → {fmtTokens(costLast)} (
              {arrow(costLast - costFirst)}),{' '}
              {intl.formatMessage(
                {
                  id: 'acceptance.trend.costTotal',
                  defaultMessage: '{total} total over {count} sessions',
                },
                { total: fmtTokens(costTotal), count: cost.length }
              )}
            </span>
          </p>
        ) : null}
        <p>
          <span className='font-medium text-foreground'>
            {intl.formatMessage({
              id: 'acceptance.trend.rework',
              defaultMessage: 'Rework: ',
            })}
          </span>
          <span className='text-muted-foreground'>
            {rw.total === 0
              ? intl.formatMessage({
                  id: 'acceptance.trend.reworkClean',
                  defaultMessage:
                    'none accrued (0) — clean across every attempt',
                })
              : intl.formatMessage(
                  {
                    id: 'acceptance.trend.reworkAccrued',
                    defaultMessage: '{total} accrued (↑ from 0)',
                  },
                  { total: rw.total }
                )}
          </span>
        </p>
      </div>
    </div>
  )
}
