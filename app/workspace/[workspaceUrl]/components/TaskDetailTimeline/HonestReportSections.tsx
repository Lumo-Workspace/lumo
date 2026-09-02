'use client'

import { useState } from 'react'
import { useIntl, type IntlShape } from 'react-intl'
import { ChevronRight, Scale } from 'lucide-react'
import { formatDurationSec } from '@/lib/datetime/duration'
import type { TaskAcceptanceStatusView } from '../../types'
import { InfoTooltip } from './InfoTooltip'
import { shouldShowClaimVsVerification } from '@/lib/claim-faithfulness/claim-mismatch'

/**
 * The honest-report sections (LUM-566) — the web render of what LUM-559~564 put
 * into `lumo task status`: the claim-vs-verification pairing (564), the cost
 * read-out (560), the struggle / rework trail (561), and the trend (562). All
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

/** A neutral provenance chip — carries 规律5's attribution (estimated /
 *  measured / AI-drafted) by a small uppercase label, not a color. */
function ProvenanceChip({
  children,
  testId,
  tip,
}: {
  children: React.ReactNode
  testId?: string
  tip?: string
}) {
  return (
    <span
      {...(testId ? { 'data-testid': testId } : {})}
      className='inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'
    >
      {children}
      {tip ? <InfoTooltip label={tip} /> : null}
    </span>
  )
}

// ── LUM-583 · Claim faithfulness (the third state) ────────────────────────────

type FaithfulnessState = NonNullable<
  TaskAcceptanceStatusView['faithfulness']
>['state']
type FaithfulnessVerdict = NonNullable<
  TaskAcceptanceStatusView['faithfulness']
>['verdict']

/** Tone classes per faithfulness state — neutral for the non-verdict states
 *  (pending / stale / unjudgeable), a feedback tone only where the verdict
 *  carries real good/bad signal. Static strings (no twMerge), so the custom
 *  font-size tiers can't collide with the color utility. */
const FAITHFULNESS_TONE: Record<string, string> = {
  success: 'border-success-border text-success',
  danger: 'border-danger-border text-danger',
  warning: 'border-warning-border text-warning',
  muted: 'border-border text-muted-foreground',
}

/** A small verdict chip stating whether the claim faithfully reflects the
 *  delivery (LUM-583) — the conclusion the two columns alone never gave. */
function FaithfulnessChip({
  glyph,
  tone,
  label,
  tip,
}: {
  glyph: string
  tone: keyof typeof FAITHFULNESS_TONE | string
  label: string
  tip?: string
}) {
  return (
    <span
      data-testid='faithfulness-chip'
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${FAITHFULNESS_TONE[tone] ?? FAITHFULNESS_TONE.muted}`}
    >
      <span aria-hidden>{glyph}</span>
      {label}
      {tip ? <InfoTooltip label={tip} /> : null}
    </span>
  )
}

function verdictLabel(intl: IntlShape, v: FaithfulnessVerdict): string {
  switch (v) {
    case 'FAITHFUL':
      return intl.formatMessage({
        id: 'acceptance.claim.faithfulness.faithful',
        defaultMessage: 'Faithful',
      })
    case 'OVERSTATED':
      return intl.formatMessage({
        id: 'acceptance.claim.faithfulness.overstated',
        defaultMessage: 'Overstated',
      })
    case 'UNDERREPORT':
      return intl.formatMessage({
        id: 'acceptance.claim.faithfulness.underreport',
        defaultMessage: 'Under-reported',
      })
    default:
      return intl.formatMessage({
        id: 'acceptance.claim.faithfulness.unjudgeable',
        defaultMessage: 'Unjudgeable',
      })
  }
}

/** Map a faithfulness state to its glyph / tone / label. The four judged
 *  verdicts carry good/bad tone; PENDING and STALE stay neutral. STALE keeps the
 *  underlying verdict visible (so the conclusion isn't lost) with a re-judge
 *  marker. ↑ = claimed more than delivered, ↓ = claimed less. */
function presentFaithfulness(
  intl: IntlShape,
  state: FaithfulnessState,
  verdict: FaithfulnessVerdict
): { glyph: string; tone: string; label: string; tip: string } {
  const tip = intl.formatMessage({
    id: 'acceptance.claim.faithfulness.tip',
    defaultMessage:
      'An independent check of whether the claim matches what was actually delivered (diff/PR): faithful = matches; overstated = claims more than was done; under-reported = claims less than was done; unjudgeable = could not decide.',
  })
  switch (state) {
    case 'FAITHFUL':
      return {
        glyph: '✓',
        tone: 'success',
        label: verdictLabel(intl, 'FAITHFUL'),
        tip,
      }
    case 'OVERSTATED':
      return {
        glyph: '↑',
        tone: 'danger',
        label: verdictLabel(intl, 'OVERSTATED'),
        tip,
      }
    case 'UNDERREPORT':
      return {
        glyph: '↓',
        tone: 'warning',
        label: verdictLabel(intl, 'UNDERREPORT'),
        tip,
      }
    case 'UNJUDGEABLE':
      return {
        glyph: '?',
        tone: 'muted',
        label: verdictLabel(intl, 'UNJUDGEABLE'),
        tip,
      }
    case 'PENDING':
      return {
        glyph: '…',
        tone: 'muted',
        label: intl.formatMessage({
          id: 'acceptance.claim.faithfulness.pending',
          defaultMessage: 'Judging…',
        }),
        tip,
      }
    case 'STALE': {
      const stale = intl.formatMessage({
        id: 'acceptance.claim.faithfulness.stale',
        defaultMessage: 'stale',
      })
      const base = verdict ? verdictLabel(intl, verdict) : ''
      return {
        glyph: '⟳',
        tone: 'muted',
        label: base ? `${base} · ${stale}` : stale,
        tip,
      }
    }
    default:
      return { glyph: '?', tone: 'muted', label: verdictLabel(intl, null), tip }
  }
}

/** Build the evidence pointer line (LUM-583) — the diff/PR the judge measured
 *  the claim against. Null when the verdict cited nothing (e.g. pending). */
function buildEvidencePointer(
  intl: IntlShape,
  f: NonNullable<TaskAcceptanceStatusView['faithfulness']>
): string | null {
  const parts: string[] = []
  if (f.prNumbers.length > 0) {
    parts.push(`PR ${f.prNumbers.map(n => `#${n}`).join(', ')}`)
  }
  if (f.diffShas.length > 0) {
    parts.push(
      f.diffShas
        .slice(0, 3)
        .map(s => s.slice(0, 7))
        .join(' ')
    )
  }
  if (parts.length === 0) return null
  const prefix = intl.formatMessage({
    id: 'acceptance.claim.faithfulness.evidence',
    defaultMessage: 'evidence:',
  })
  return `${prefix} ${parts.join(' · ')}`
}

/** The faithfulness conclusion under the claim (LUM-583): a chip stating whether
 *  the claim is true, plus a pointer to the diff/PR it was judged against. */
function FaithfulnessRow({
  f,
}: {
  f: NonNullable<TaskAcceptanceStatusView['faithfulness']>
}) {
  const intl = useIntl()
  const present = presentFaithfulness(intl, f.state, f.verdict)
  const evidence = buildEvidencePointer(intl, f)
  return (
    <div
      data-testid='faithfulness-row'
      data-faithfulness-state={f.state}
      className='mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2'
    >
      <span className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
        {intl.formatMessage({
          id: 'acceptance.claim.faithfulness.label',
          defaultMessage: 'Faithfulness',
        })}
      </span>
      <FaithfulnessChip
        glyph={present.glyph}
        tone={present.tone}
        label={present.label}
        tip={present.tip}
      />
      {evidence ? (
        <span
          data-testid='faithfulness-evidence'
          className='text-[10px] text-muted-foreground/70'
        >
          {evidence}
        </span>
      ) : null}
    </div>
  )
}

// ── LUM-597 · Claim reality-check (the collapsed claim line) ───────────────────

/**
 * LUM-597 — the claim collapsed to a single "reality check" line. Decision-first:
 * the reviewer decides on the verification block; the claim's only job is to flag
 * when it disagrees with reality. So the headline IS the faithfulness conclusion
 * (loud only on a mismatch, quiet when faithful), a provenance chip tells the
 * agent's own self-report (AGENT) apart from a summarizer paraphrase
 * (SYNTHESIZED), and the self-report text folds away. Renders nothing at all when
 * there is no claim — no empty box.
 */
function ClaimRealityCheck({
  claim,
  faithfulness,
}: {
  claim: TaskAcceptanceStatusView['claim']
  faithfulness: TaskAcceptanceStatusView['faithfulness']
}) {
  const intl = useIntl()
  const hasText = !!(
    claim?.text &&
    (claim.source === 'AGENT' || claim.source === 'RUN_SUMMARY')
  )
  const isDigest = claim?.source === 'DIGEST'
  // 无声称 → 整行消失 (never an empty box).
  if (!hasText && !isDigest) return null
  const isAgent = claim?.source === 'AGENT'

  return (
    <div
      data-testid='claim-reality-check'
      className='rounded-md border border-border/70 px-3.5 py-2.5'
    >
      <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
        <span className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
          {intl.formatMessage({
            id: 'acceptance.claim.realityCheck',
            defaultMessage: 'Reality check',
          })}
        </span>
        <ProvenanceChip
          testId='claim-provenance'
          tip={intl.formatMessage(
            isAgent
              ? {
                  id: 'acceptance.claim.selfReportTip',
                  defaultMessage:
                    'The agent’s own required self-report, attached when it requested review — an estimate, checked against the diff.',
                }
              : {
                  id: 'acceptance.claim.synthesizedTip',
                  defaultMessage:
                    'No agent self-report — a summarizer paraphrase of the session, shown as a fallback.',
                }
          )}
        >
          {isAgent
            ? intl.formatMessage({
                id: 'acceptance.claim.selfReport',
                defaultMessage: 'agent self-report',
              })
            : intl.formatMessage({
                id: 'acceptance.claim.synthesized',
                defaultMessage: 'synthesized',
              })}
        </ProvenanceChip>
      </div>

      {/* Headline conclusion: faithfulness — loud only on a mismatch. */}
      {faithfulness ? (
        <FaithfulnessRow f={faithfulness} />
      ) : hasText ? (
        <p className='mt-2 text-[11px] text-muted-foreground'>
          {intl.formatMessage({
            id: 'acceptance.claim.checkPending',
            defaultMessage:
              'self-report recorded — not yet checked against the diff.',
          })}
        </p>
      ) : null}

      {/* The self-report itself folds away — there if you want it, quiet if not. */}
      {hasText ? (
        <details className='mt-1.5'>
          <summary className='cursor-pointer text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70 hover:text-muted-foreground'>
            {intl.formatMessage({
              id: 'acceptance.claim.showSelfReport',
              defaultMessage: 'self-report',
            })}
          </summary>
          <p className='mt-1 whitespace-pre-line text-[12px] leading-snug text-foreground'>
            {claim!.text}
          </p>
        </details>
      ) : (
        <p className='mt-2 text-[12px] italic leading-snug text-muted-foreground'>
          {intl.formatMessage({
            id: 'acceptance.claim.generating',
            defaultMessage:
              'Generating — the formal run summary is still being synthesized.',
          })}
        </p>
      )}
    </div>
  )
}

// ── LUM-564 · Claim vs verification ───────────────────────────────────────────

/**
 * LUM-730 — the section exists only when the claim disagrees with the delivery
 * (faithfulness OVERSTATED / UNDERREPORT, or STALE over one of those). A
 * faithful, still-judging, unjudgeable or absent claim renders nothing at all —
 * not a collapsed header, nothing — so on the common path the tab loses a block
 * of noise and the section itself is the alarm. The decision is the pure
 * `shouldShowClaimVsVerification` in `@/lib/claim-faithfulness/claim-mismatch`.
 */
export function ClaimVsVerification({
  data,
}: {
  data: TaskAcceptanceStatusView
}) {
  const intl = useIntl()
  const claim = data.claim
  // The server always sends the rollup; default defensively so a degraded /
  // partial payload renders the pairing rather than crashing the whole tab.
  const mv = data.machineVerification ?? {
    total: 0,
    machineVerified: 0,
    humanOverridden: 0,
  }
  const met = data.criteria.length - data.nextActions.length
  // LUM-572: a self-collapsing section so the claim pairing folds away like the
  // other Record-tab sections. Default open — it's decision-relevant.
  const [open, setOpen] = useState(true)

  // LUM-730: no mismatch → no section. After the hooks so the hook order is
  // stable across the show/hide flip.
  if (!shouldShowClaimVsVerification(data.faithfulness)) return null

  return (
    <div className='overflow-hidden rounded-lg border border-border'>
      <div className='flex items-center gap-1.5 px-4 py-3 text-body-strong text-foreground'>
        <button
          type='button'
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className='flex items-center gap-1.5 hover:text-foreground'
        >
          <ChevronRight
            className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden
          />
          <Scale
            className='size-4 shrink-0 text-muted-foreground'
            aria-hidden
          />
          {intl.formatMessage({
            id: 'acceptance.claim.title',
            defaultMessage: 'Claim vs verification',
          })}
        </button>
        <InfoTooltip
          label={intl.formatMessage({
            id: 'acceptance.claim.tip',
            defaultMessage:
              'The agent’s self-report (what it says it did) sits next to the measured verdict (what was actually confirmed). A claim is an estimate, never a measurement.',
          })}
        />
      </div>
      {open ? (
        <div className='space-y-3 border-t border-border px-4 py-4'>
          {/* Verification (核验) — the decision surface. LUM-597 decision-first:
              the measured verdict the reviewer actually acts on is the framed
              main block, not a co-equal column beside the claim. */}
          <div
            data-testid='verification-main'
            className='rounded-md border border-border bg-muted/30 px-3.5 py-3'
          >
            <div className='mb-0.5 flex items-center gap-1.5'>
              <span className='text-[11px] font-medium text-foreground'>
                {intl.formatMessage({
                  id: 'acceptance.claim.verifyLabel',
                  defaultMessage: 'Verification — what was confirmed',
                })}
              </span>
              <ProvenanceChip>
                {intl.formatMessage({
                  id: 'acceptance.claim.measured',
                  defaultMessage: 'measured',
                })}
              </ProvenanceChip>
            </div>
            {data.currentRound === 0 ? (
              <p className='text-[12px] italic leading-snug text-muted-foreground'>
                {intl.formatMessage({
                  id: 'acceptance.claim.unconfirmed',
                  defaultMessage:
                    'No verification has run yet — the claim is unconfirmed.',
                })}
              </p>
            ) : (
              <div className='space-y-0.5 text-[12px] leading-snug text-foreground'>
                {mv.total > 0 ? (
                  <p>
                    {intl.formatMessage(
                      {
                        id: 'acceptance.claim.rollup',
                        defaultMessage:
                          '{verified} machine-verified · {overridden} human override (of {total} MACHINE criteria)',
                      },
                      {
                        verified: mv.machineVerified,
                        overridden: mv.humanOverridden,
                        total: mv.total,
                      }
                    )}
                  </p>
                ) : null}
                <p className='text-muted-foreground'>
                  {intl.formatMessage(
                    {
                      id: 'acceptance.claim.met',
                      defaultMessage:
                        '{met} of {total} criteria met by their latest verdict',
                    },
                    { met, total: data.criteria.length }
                  )}
                </p>
              </div>
            )}
          </div>

          {/* Claim (声称) — one "reality check" line; disappears when none. */}
          <ClaimRealityCheck claim={claim} faithfulness={data.faithfulness} />
        </div>
      ) : null}
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
