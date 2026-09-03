'use client'

import { useIntl } from 'react-intl'
import { formatDurationSec } from '@/lib/datetime/duration'
import type { TaskAcceptanceStatusView } from '../../types'
import { InfoTooltip } from './InfoTooltip'

/**
 * The honest-report sections (LUM-566) — the web render of what LUM-559~564 put
 * into `lumo task status --full`: the cost read-out (560), the struggle /
 * rework trail (561), and the trend (562). (The claim-vs-verification pairing
 * and the faithfulness verdict were retired from the front-end in LUM-733.) All
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
function fmtTokens(n: number): string {
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

// ── LUM-560 · Cost ────────────────────────────────────────────────────────────

export function CostSection({ data }: { data: TaskAcceptanceStatusView }) {
  const intl = useIntl()
  const cost = data.cost
  if (!cost) return null // older server: no cost data — never fabricate one.

  return (
    <div>
      <SectionTitle
        tip={intl.formatMessage({
          id: 'acceptance.cost.tip',
          defaultMessage:
            'Token spend, active (non-idle) time and machine rework rounds for this task — the same source as the delivery card, so the two never drift.',
        })}
      >
        {intl.formatMessage({
          id: 'acceptance.cost.title',
          defaultMessage: 'Cost',
        })}
      </SectionTitle>
      <dl className='grid grid-cols-3 divide-x divide-border overflow-hidden rounded-md border border-border'>
        <div className='px-4 py-3'>
          <dt className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
            {intl.formatMessage({
              id: 'acceptance.cost.tokens',
              defaultMessage: 'Tokens',
            })}
          </dt>
          <dd
            data-testid='cost-tokens'
            className={
              cost.tokenCost == null
                ? 'mt-1 text-[11px] italic leading-snug text-muted-foreground'
                : 'mt-1 text-heading text-foreground'
            }
          >
            {cost.tokenCost == null
              ? intl.formatMessage({
                  id: 'acceptance.cost.notRecorded',
                  defaultMessage: 'Not recorded (no session usage captured)',
                })
              : fmtTokens(cost.tokenCost)}
          </dd>
        </div>
        <div className='px-4 py-3'>
          <dt className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
            {intl.formatMessage({
              id: 'acceptance.cost.activeTime',
              defaultMessage: 'Active time',
            })}
          </dt>
          <dd className='mt-1 text-heading text-foreground'>
            {formatDurationSec(intl, cost.activeTimeSec)}
          </dd>
        </div>
        <div className='px-4 py-3'>
          <dt className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
            {intl.formatMessage({
              id: 'acceptance.cost.rework',
              defaultMessage: 'Rework rounds',
            })}
          </dt>
          <dd className='mt-1 text-heading text-foreground'>
            {cost.reworkRounds}
          </dd>
        </div>
      </dl>
    </div>
  )
}

// ── LUM-561 · Struggle / rework / outstanding ─────────────────────────────────

export function StruggleTrailSection({
  data,
}: {
  data: TaskAcceptanceStatusView
}) {
  const intl = useIntl()
  const trail = data.struggleTrail
  if (!trail) return null // older server: can't fabricate, so don't claim "none".

  const prIterated = trail.pullRequests.length > 1
  const empty =
    trail.reworkRounds.length === 0 &&
    trail.sendBacks.length === 0 &&
    trail.followUps.length === 0 &&
    trail.reopens.length === 0 &&
    !prIterated

  return (
    <div>
      <SectionTitle
        tip={intl.formatMessage({
          id: 'acceptance.struggle.tip',
          defaultMessage:
            'The rework a clean all-pass report would otherwise hide: FAIL rounds, send-backs, leftover follow-ups, multiple PR cycles and review/done reopens. Always shown — an empty trail states its basis instead of disappearing.',
        })}
      >
        {intl.formatMessage({
          id: 'acceptance.struggle.title',
          defaultMessage: 'Struggle / rework / outstanding',
        })}
      </SectionTitle>

      {empty ? (
        <p className='rounded-md border border-border px-3 py-2.5 text-[12px] leading-snug text-muted-foreground'>
          {data.currentRound === 0
            ? intl.formatMessage({
                id: 'acceptance.struggle.unverified',
                defaultMessage:
                  'No verification has run yet — cannot confirm there were no difficulties. Run lumo verify.',
              })
            : intl.formatMessage(
                {
                  id: 'acceptance.struggle.noneRecorded',
                  defaultMessage:
                    'None recorded — {rounds, plural, one {# verification round} other {# verification rounds}} run, 0 FAIL, no send-backs, no reopens, no leftover follow-ups.',
                },
                { rounds: data.currentRound }
              )}
        </p>
      ) : (
        <div className='space-y-2 rounded-md border border-border px-3 py-2.5 text-[12px] leading-snug'>
          {trail.reworkRounds.length > 0 ? (
            <p className='text-foreground'>
              <span className='font-medium'>
                {intl.formatMessage({
                  id: 'acceptance.struggle.reworkRounds',
                  defaultMessage: 'Rework rounds: ',
                })}
              </span>
              {trail.reworkRounds
                .map(r =>
                  intl.formatMessage(
                    {
                      id: 'acceptance.struggle.reworkRound',
                      defaultMessage: 'round {round} ({failed} FAIL)',
                    },
                    { round: r.round, failed: r.failed }
                  )
                )
                .join(', ')}
            </p>
          ) : null}

          {trail.sendBacks.length > 0 ? (
            <div>
              <p className='font-medium text-foreground'>
                {intl.formatMessage({
                  id: 'acceptance.struggle.sendBacks',
                  defaultMessage: 'Send-backs',
                })}
              </p>
              <ul className='mt-0.5 space-y-0.5'>
                {trail.sendBacks.map(s => (
                  <li key={s.criterionId} className='text-muted-foreground'>
                    <span className='text-foreground'>{s.statement}</span>
                    {' — '}
                    {s.status === 'resolved'
                      ? intl.formatMessage(
                          {
                            id: 'acceptance.struggle.sendBackResolved',
                            defaultMessage:
                              'resolved (sent back r{failed}{arrow})',
                          },
                          {
                            failed: s.failedAtRound,
                            arrow:
                              s.resolvedAtRound != null
                                ? ` → r${s.resolvedAtRound}`
                                : '',
                          }
                        )
                      : intl.formatMessage(
                          {
                            id: 'acceptance.struggle.sendBackOpen',
                            defaultMessage: 'open (sent back r{failed})',
                          },
                          { failed: s.failedAtRound }
                        )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {trail.followUps.length > 0 ? (
            <div>
              <p className='font-medium text-foreground'>
                {intl.formatMessage({
                  id: 'acceptance.struggle.followUps',
                  defaultMessage: 'Follow-ups left behind',
                })}
              </p>
              <ul className='mt-0.5 space-y-0.5'>
                {trail.followUps.map(f => (
                  <li key={f.criterionId} className='text-muted-foreground'>
                    <span className='text-foreground'>{f.statement}</span>
                    {intl.formatMessage(
                      {
                        id: 'acceptance.struggle.followUpAt',
                        defaultMessage: ' — flagged r{round}',
                      },
                      { round: f.round }
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

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
function passPct(p: { passed: number; failed: number }): number {
  const total = p.passed + p.failed
  return total === 0 ? 0 : Math.round((p.passed / total) * 100)
}

export function TrendSection({ data }: { data: TaskAcceptanceStatusView }) {
  const intl = useIntl()
  const trend = data.trend
  if (!trend) return null // older server: no trend data — don't invent one.

  const rounds = trend.passRate
  const cost = trend.cost
  const rw = trend.rework
  const title = intl.formatMessage({
    id: 'acceptance.trend.title',
    defaultMessage: 'Trend',
  })
  const tip = intl.formatMessage({
    id: 'acceptance.trend.tip',
    defaultMessage:
      'Movement across attempts — pass rate, cost per session and rework accrual — not a single-point snapshot. A single attempt says so rather than drawing a fake trend.',
  })

  // Nothing to trend, or a single point — say so plainly (no fake arrow).
  if (rounds.length === 0 && cost.length === 0) {
    return (
      <div>
        <SectionTitle tip={tip}>{title}</SectionTitle>
        <p className='rounded-md border border-border px-3 py-2.5 text-[12px] text-muted-foreground'>
          {intl.formatMessage({
            id: 'acceptance.trend.nothing',
            defaultMessage:
              'No verification rounds or measured cost yet — nothing to trend.',
          })}
        </p>
      </div>
    )
  }

  const hasTrajectory = rounds.length >= 2 || cost.length >= 2
  if (!hasTrajectory) {
    const bits: string[] = []
    if (rounds[0])
      bits.push(
        intl.formatMessage(
          {
            id: 'acceptance.trend.bitPass',
            defaultMessage: 'pass rate r{round} {pct}%',
          },
          { round: rounds[0].round, pct: passPct(rounds[0]) }
        )
      )
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
                'Single attempt so far — no trajectory yet (a trend needs ≥2 rounds or sessions).',
            })}
          </p>
          <p className='text-foreground'>{bits.join(' · ')}</p>
        </div>
      </div>
    )
  }

  const passDelta =
    rounds.length >= 2
      ? passPct(rounds[rounds.length - 1]!) - passPct(rounds[0]!)
      : 0
  const costFirst = cost[0]?.total ?? 0
  const costLast = cost[cost.length - 1]?.total ?? 0
  const costTotal = cost.reduce((a, c) => a + c.total, 0)

  return (
    <div>
      <SectionTitle tip={tip}>{title}</SectionTitle>
      <div className='space-y-1 rounded-md border border-border px-3 py-2.5 text-[12px] leading-snug'>
        {rounds.length >= 2 ? (
          <p>
            <span className='font-medium text-foreground'>
              {intl.formatMessage({
                id: 'acceptance.trend.passRate',
                defaultMessage: 'Pass rate: ',
              })}
            </span>
            <span className='text-muted-foreground'>
              {rounds.map(r => `r${r.round} ${passPct(r)}%`).join(' → ')} (
              {arrow(passDelta)} {passDelta > 0 ? `+${passDelta}` : passDelta}
              pts)
            </span>
          </p>
        ) : null}
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
