'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react'
import { useTaskStatus } from '../../hooks/useTaskStatus'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
  VerificationHistoryRoundView,
  AcceptanceVerifier,
} from '../../types'
import { VerdictGlyph } from './items/AcceptanceBatchItem'

interface AcceptanceTabProps {
  taskIdentifier: string
  enabled: boolean
}

function isPass(verdict: string | undefined): boolean {
  return verdict === 'PASS' || verdict === 'PASS_WITH_FOLLOWUP'
}

// A human override = a passing verdict authored by a HUMAN verifier (the red
// line's "provable manual override", distinct from a machine PASS).
function isHumanOverride(c: TaskStatusCriterionView): boolean {
  const v = c.latestVerdict
  return !!v && isPass(v.verdict) && v.verifierType === 'HUMAN'
}

// ── Verdict banner ───────────────────────────────────────────────────────────

type Tone = 'success' | 'danger' | 'neutral'

const TONE_BOX: Record<Tone, string> = {
  success: 'bg-success-subtle border-success-border',
  danger: 'bg-danger-subtle border-danger-border',
  neutral: 'bg-muted border-border',
}
const TONE_TEXT: Record<Tone, string> = {
  success: 'text-success',
  danger: 'text-danger',
  neutral: 'text-muted-foreground',
}

function VerdictBanner({ data }: { data: TaskAcceptanceStatusView }) {
  const intl = useIntl()
  const total = data.criteria.length
  const met = data.criteria.filter(c => isPass(c.latestVerdict?.verdict)).length
  const hasFail = data.criteria.some(c => c.latestVerdict?.verdict === 'FAIL')
  const hasHumanOverride = data.criteria.some(isHumanOverride)
  const anyHumanVerdict = data.criteria.some(
    c => c.latestVerdict?.verifierType === 'HUMAN'
  )
  const machineCriteria = data.criteria.filter(c => c.verifierType === 'MACHINE')
  const machineAllPass =
    machineCriteria.length > 0 &&
    machineCriteria.every(c => isPass(c.latestVerdict?.verdict))

  let tone: Tone = 'neutral'
  let Icon = Clock
  let title: string

  if (data.escalated) {
    tone = 'danger'
    Icon = AlertTriangle
    title = intl.formatMessage({
      id: 'acceptance.banner.escalated',
      defaultMessage: 'Escalated to human · machine loop exhausted',
    })
  } else if (hasFail) {
    tone = 'danger'
    Icon = XCircle
    const count = data.criteria.filter(
      c => c.latestVerdict?.verdict === 'FAIL'
    ).length
    title = intl.formatMessage(
      {
        id: 'acceptance.banner.sentBack',
        defaultMessage:
          '{count, plural, one {# criterion sent back} other {# criteria sent back}} · blocks DONE',
      },
      { count }
    )
  } else if (data.task.status === 'DONE') {
    tone = 'success'
    Icon = CheckCircle2
    title = anyHumanVerdict
      ? intl.formatMessage({
          id: 'acceptance.banner.done',
          defaultMessage: 'Completed',
        })
      : intl.formatMessage({
          id: 'acceptance.banner.doneNoHumanVerdict',
          defaultMessage: 'Completed · no human verdict (shown as-is)',
        })
  } else if (met === total && total > 0) {
    tone = 'success'
    Icon = CheckCircle2
    title = intl.formatMessage({
      id: 'acceptance.banner.allPassed',
      defaultMessage: 'All criteria met',
    })
  } else if (machineAllPass) {
    tone = 'success'
    Icon = CheckCircle2
    title = intl.formatMessage({
      id: 'acceptance.banner.machineAwaitingHuman',
      defaultMessage: 'Machine acceptance passed · awaiting human verdict',
    })
  } else {
    title = intl.formatMessage({
      id: 'acceptance.banner.inProgress',
      defaultMessage: 'Acceptance in progress',
    })
  }

  const gate = hasFail
    ? intl.formatMessage({
        id: 'acceptance.banner.gateBlocked',
        defaultMessage: 'a send-back blocks DONE',
      })
    : intl.formatMessage({
        id: 'acceptance.banner.gateOpen',
        defaultMessage: 'no send-back · human PASS or DONE allowed',
      })

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3.5 py-3 ${TONE_BOX[tone]}`}
    >
      <Icon className={`size-6 shrink-0 ${TONE_TEXT[tone]}`} aria-hidden />
      <div className='min-w-0 flex-1'>
        <div className='text-sm font-medium text-foreground'>{title}</div>
        <div className='mt-0.5 text-xs text-muted-foreground'>
          {intl.formatMessage(
            {
              id: 'acceptance.banner.metCount',
              defaultMessage: '{passed}/{total} met',
            },
            { passed: met, total }
          )}
          {hasHumanOverride ? (
            <>
              {' · '}
              {intl.formatMessage({
                id: 'acceptance.tab.humanOverride',
                defaultMessage: 'human override',
              })}
            </>
          ) : null}
          {' · '}
          {gate}
        </div>
      </div>
      <span className='shrink-0 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground'>
        {intl.formatMessage(
          {
            id: 'acceptance.banner.roundBadge',
            defaultMessage: 'round {round}/{max}',
          },
          { round: data.currentRound, max: data.maxRounds }
        )}
      </span>
    </div>
  )
}

// ── Verification record (round history) ──────────────────────────────────────

function roundVerifier(round: VerificationHistoryRoundView): AcceptanceVerifier | null {
  const set = new Set(round.verdicts.map(v => v.verifierType))
  return set.size === 1 ? [...set][0]! : null
}

function VerificationHistory({ data }: { data: TaskAcceptanceStatusView }) {
  const intl = useIntl()
  const [open, setOpen] = useState<Set<number>>(() => new Set())
  const statementById = useMemo(
    () => new Map(data.criteria.map(c => [c.id, c.statement])),
    [data.criteria]
  )

  if (data.verificationHistory.length === 0) return null

  const rounds = [...data.verificationHistory].sort((a, b) => a.round - b.round)

  const toggle = (round: number) =>
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(round)) next.delete(round)
      else next.add(round)
      return next
    })

  const roundLabel = (r: VerificationHistoryRoundView): string => {
    const v = roundVerifier(r)
    if (v === 'MACHINE')
      return intl.formatMessage(
        {
          id: 'acceptance.history.roundMachine',
          defaultMessage: 'round {round} · machine check',
        },
        { round: r.round }
      )
    if (v === 'HUMAN')
      return intl.formatMessage(
        {
          id: 'acceptance.history.roundHuman',
          defaultMessage: 'round {round} · human verdict',
        },
        { round: r.round }
      )
    if (v === 'AGENT')
      return intl.formatMessage(
        {
          id: 'acceptance.history.roundAgent',
          defaultMessage: 'round {round} · agent send-back',
        },
        { round: r.round }
      )
    return intl.formatMessage(
      { id: 'acceptance.history.roundGeneric', defaultMessage: 'round {round}' },
      { round: r.round }
    )
  }

  return (
    <div>
      <div className='mb-2 text-xs font-medium text-muted-foreground'>
        {intl.formatMessage({
          id: 'acceptance.history.title',
          defaultMessage: 'Verification record',
        })}
      </div>
      <div className='overflow-hidden rounded-lg border border-border'>
        {rounds.map((r, i) => {
          const expanded = open.has(r.round)
          const tonePass = r.failed === 0
          return (
            <div
              key={r.round}
              className={i > 0 ? 'border-t border-border' : undefined}
            >
              <button
                type='button'
                aria-expanded={expanded}
                onClick={() => toggle(r.round)}
                className='flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors'
              >
                <ChevronRight
                  className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
                  aria-hidden
                />
                <span className='text-xs text-foreground'>{roundLabel(r)}</span>
                <span
                  className={`rounded-sm px-1.5 text-[11px] font-medium ${
                    tonePass
                      ? 'bg-success-subtle border border-success-border text-foreground'
                      : 'bg-danger-subtle border border-danger-border text-foreground'
                  }`}
                >
                  {intl.formatMessage(
                    {
                      id: 'acceptance.history.passCount',
                      defaultMessage: '{passed}/{total} passed',
                    },
                    { passed: r.passed, total: r.verdicts.length }
                  )}
                </span>
                <span className='ml-auto text-[11px] text-muted-foreground'>
                  {new Date(r.recordedAt).toLocaleString(intl.locale)}
                </span>
              </button>
              {expanded ? (
                <div className='space-y-1 border-t border-border/60 px-3 py-2 pl-8'>
                  {r.verdicts.map(v => (
                    <div
                      key={`${v.criterionId}-${v.verifierType}`}
                      className='flex items-baseline gap-2 text-[11px] text-muted-foreground'
                    >
                      <span className='translate-y-0.5'>
                        <VerdictGlyph verdict={v.verdict} />
                      </span>
                      <span className='min-w-0 flex-1'>
                        {statementById.get(v.criterionId) ?? v.criterionId}
                        {v.verdict === 'FAIL' && v.rejectionReason ? (
                          <span className='text-danger'>
                            {' '}
                            — {v.rejectionReason}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Contract (criteria with their result) ────────────────────────────────────

const SOURCE_PILL: Record<string, string> = {
  HUMAN_EDIT: 'border border-border text-muted-foreground',
  REVIEW_ADDED: 'bg-warning-subtle border border-warning-border text-foreground',
}

function resultBadge(
  c: TaskStatusCriterionView,
  intl: ReturnType<typeof useIntl>
): { label: string; cls: string } {
  const verdict = c.latestVerdict?.verdict
  if (isPass(verdict))
    return {
      label: intl.formatMessage({
        id: 'acceptance.result.pass',
        defaultMessage: 'Passed',
      }),
      cls: 'bg-success-subtle border border-success-border text-foreground',
    }
  if (verdict === 'FAIL')
    return {
      label: intl.formatMessage({
        id: 'acceptance.result.fail',
        defaultMessage: 'Failed',
      }),
      cls: 'bg-danger-subtle border border-danger-border text-foreground',
    }
  return {
    label:
      c.verifierType === 'HUMAN'
        ? intl.formatMessage({
            id: 'acceptance.result.awaitingHuman',
            defaultMessage: 'Awaiting human verdict',
          })
        : intl.formatMessage({
            id: 'acceptance.result.awaitingCheck',
            defaultMessage: 'Awaiting verification',
          }),
    cls: 'border border-border text-muted-foreground',
  }
}

function CriterionRow({ c }: { c: TaskStatusCriterionView }) {
  const intl = useIntl()
  const [showCheck, setShowCheck] = useState(false)
  const v = c.latestVerdict
  const badge = resultBadge(c, intl)
  // Only MACHINE criteria carry a runnable check / evidence to disclose.
  const hasCheck = c.verifierType === 'MACHINE' && (!!c.checkpointer || !!v)

  return (
    <div className='flex gap-3 px-3 py-3 border-t border-border/60 first:border-t-0'>
      <span className='mt-0.5'>
        <VerdictGlyph verdict={v?.verdict ?? ''} />
      </span>
      <div className='min-w-0 flex-1'>
        <div className='line-clamp-2 text-[13px] leading-snug text-foreground'>
          {c.statement}
        </div>
        <div className='mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]'>
          <span className={`rounded-sm px-1.5 py-0.5 font-medium ${badge.cls}`}>
            {badge.label}
          </span>
          <span className='rounded-sm border border-border px-1.5 py-0.5 text-muted-foreground'>
            {c.verifierType}
          </span>
          {/* Provenance only when notable — AGENT_DRAFT is the silent default. */}
          {c.source !== 'AGENT_DRAFT' ? (
            <span
              className={`rounded-sm px-1.5 py-0.5 font-medium ${SOURCE_PILL[c.source] ?? 'border border-border text-muted-foreground'}`}
            >
              {c.source}
            </span>
          ) : null}
          {isHumanOverride(c) ? (
            <span className='rounded-sm bg-success-subtle border border-success-border px-1.5 py-0.5 font-medium text-foreground'>
              {intl.formatMessage({
                id: 'acceptance.tab.humanOverride',
                defaultMessage: 'human override',
              })}
            </span>
          ) : null}
          {hasCheck ? (
            <button
              type='button'
              aria-expanded={showCheck}
              onClick={() => setShowCheck(s => !s)}
              className='ml-auto inline-flex items-center gap-0.5 text-info hover:underline'
            >
              {showCheck
                ? intl.formatMessage({
                    id: 'acceptance.hideCheck',
                    defaultMessage: 'Hide check output',
                  })
                : intl.formatMessage({
                    id: 'acceptance.viewCheck',
                    defaultMessage: 'View check output',
                  })}
              <ChevronRight
                className={`size-3 transition-transform ${showCheck ? 'rotate-90' : ''}`}
                aria-hidden
              />
            </button>
          ) : null}
        </div>
        {/* FAIL reason is part of the result — surfaced without a disclosure. */}
        {v?.verdict === 'FAIL' && v.rejectionReason ? (
          <div className='mt-1 text-[11px] text-danger break-words'>
            {v.rejectionReason}
          </div>
        ) : null}
        {hasCheck && showCheck ? (
          <div className='mt-1.5 space-y-1 rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[10px] text-muted-foreground'>
            {c.checkpointer ? (
              <div className='break-all'>
                <span className='text-foreground/60'>
                  {intl.formatMessage({
                    id: 'acceptance.check.label',
                    defaultMessage: 'check',
                  })}
                  :{' '}
                </span>
                {c.checkpointer}
              </div>
            ) : null}
            <div className='break-all'>
              <span className='text-foreground/60'>
                {intl.formatMessage({
                  id: 'acceptance.check.evidence',
                  defaultMessage: 'evidence',
                })}
                :{' '}
              </span>
              {v?.evidencePointer ??
                intl.formatMessage({
                  id: 'acceptance.check.none',
                  defaultMessage: 'not yet run',
                })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── Tab ──────────────────────────────────────────────────────────────────────

export function AcceptanceTab({ taskIdentifier, enabled }: AcceptanceTabProps) {
  const intl = useIntl()
  const { data, loading, error } = useTaskStatus({
    identifier: taskIdentifier,
    enabled,
  })

  if (loading && !data) {
    return (
      <div className='py-8 text-center text-xs text-muted-foreground'>
        {intl.formatMessage({
          id: 'acceptance.tab.loading',
          defaultMessage: '加载中…',
        })}
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

  const machineCount = data.criteria.filter(
    c => c.verifierType === 'MACHINE'
  ).length
  const humanCount = data.criteria.length - machineCount

  return (
    <div className='space-y-5 py-1'>
      <VerdictBanner data={data} />

      <VerificationHistory data={data} />

      <div>
        <div className='mb-2 text-xs font-medium text-muted-foreground'>
          {intl.formatMessage({
            id: 'acceptance.contract.title',
            defaultMessage: 'Acceptance criteria',
          })}{' '}
          <span className='font-normal text-muted-foreground/70'>
            ·{' '}
            {intl.formatMessage(
              {
                id: 'acceptance.contract.count',
                defaultMessage: '{total} · {machine} MACHINE / {human} HUMAN',
              },
              {
                total: data.criteria.length,
                machine: machineCount,
                human: humanCount,
              }
            )}
          </span>
        </div>
        <div className='overflow-hidden rounded-lg border border-border'>
          {data.criteria.map(c => (
            <CriterionRow key={c.id} c={c} />
          ))}
        </div>
      </div>

      {data.lastRoundFailures.length > 0 ? (
        <div>
          <div className='mb-2 text-xs font-medium text-foreground'>
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

      {data.nextActions.length > 0 ? (
        <div>
          <div className='mb-2 text-xs font-medium text-foreground'>
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
