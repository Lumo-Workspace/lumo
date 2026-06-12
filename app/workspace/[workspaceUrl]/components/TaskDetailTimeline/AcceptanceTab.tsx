'use client'

import { useCallback, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronRight,
  Pencil,
  Archive,
  Trash2,
} from 'lucide-react'
import { tasksClient } from '@/lib/api-client'
import { useTaskStatus } from '../../hooks/useTaskStatus'
import type {
  AcceptanceVerdict,
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
  VerificationHistoryRoundView,
  AcceptanceVerifier,
  WorkspaceMemberInfo,
  RemovedCriterionView,
  CriteriaSetItemInput,
} from '../../types'
import { VerdictGlyph } from './items/AcceptanceBatchItem'
import { BoundaryCrossingsPanel } from './BoundaryCrossingsPanel'

interface AcceptanceTabProps {
  taskIdentifier: string
  enabled: boolean
  /** Workspace URL slug, for linking a spawned remediation task from the panel. */
  workspaceUrl?: string
  /** For resolving the disposition reviewer's name on the crossings panel. */
  members?: WorkspaceMemberInfo[]
  agentActors?: { actorId: string; name: string }[]
}

/** Records a human verdict (whole-contract when criterionIds is omitted). */
type SubmitVerdict = (
  verdict: AcceptanceVerdict,
  criterionIds?: string[],
  note?: string
) => void

function isPass(verdict: string | undefined): boolean {
  return verdict === 'PASS' || verdict === 'PASS_WITH_FOLLOWUP'
}

/** Echo every active criterion back as a desired-list item so a statement-only
 *  edit preserves MACHINE checkpointers (the server full-replaces by id). */
function toSetItems(
  criteria: TaskStatusCriterionView[]
): CriteriaSetItemInput[] {
  return criteria.map(c => ({
    id: c.id,
    statement: c.statement,
    verifierType: c.verifierType,
    ...(c.checkpointer ? { checkpointer: c.checkpointer } : {}),
    evidenceRequired: c.evidenceRequired,
  }))
}

// Machine evidence is encoded as `cmd:<command>#exit=<n>` — pull out the exit
// code so the disclosure can show a plain "exit code 0" instead of the raw
// pointer (the command itself is the criterion's checkpointer, shown above it).
function parseExitCode(evidence: string | null | undefined): number | null {
  if (!evidence) return null
  const m = evidence.match(/#exit=(-?\d+)\s*$/)
  return m ? Number(m[1]) : null
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
  const machineCriteria = data.criteria.filter(
    c => c.verifierType === 'MACHINE'
  )
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

function roundVerifier(
  round: VerificationHistoryRoundView
): AcceptanceVerifier | null {
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
      {
        id: 'acceptance.history.roundGeneric',
        defaultMessage: 'round {round}',
      },
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
  REVIEW_ADDED:
    'bg-warning-subtle border border-warning-border text-foreground',
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

// ── Human verdict controls (LUM-425) ─────────────────────────────────────────
//
// Inline pass / send-back controls, rendered only while the task is IN_REVIEW.
// Reused at two scopes: per-criterion (criterionIds = [c.id]) and task-level
// (criterionIds = undefined → the whole-contract "pass all / send back all").
// `secondary` collapses the controls behind an unobtrusive "Override" toggle —
// used on machine-passed rows so a human doesn't fat-finger overturning a green
// machine result, while still allowing the red line's provable manual override.

function VerdictControls({
  idSuffix,
  criterionIds,
  secondary,
  submitting,
  onVerdict,
}: {
  idSuffix: string
  criterionIds: string[] | undefined
  secondary: boolean
  submitting: boolean
  onVerdict: SubmitVerdict
}) {
  const intl = useIntl()
  const [open, setOpen] = useState(!secondary)
  const [sendBack, setSendBack] = useState(false)
  const [note, setNote] = useState('')

  if (secondary && !open) {
    return (
      <button
        type='button'
        data-testid={`verdict-override-${idSuffix}`}
        onClick={() => setOpen(true)}
        className='text-[11px] text-muted-foreground/80 hover:text-foreground hover:underline'
      >
        {intl.formatMessage({
          id: 'acceptance.verdict.override',
          defaultMessage: 'Override',
        })}
      </button>
    )
  }

  const passCls = secondary
    ? 'rounded-sm border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted'
    : 'rounded-sm bg-success-subtle border border-success-border px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-success-subtle/70'

  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center gap-1.5'>
        <button
          type='button'
          data-testid={`verdict-pass-${idSuffix}`}
          disabled={submitting}
          onClick={() => onVerdict('PASS', criterionIds)}
          className={`${passCls} disabled:opacity-50`}
        >
          {intl.formatMessage({
            id: 'acceptance.verdict.pass',
            defaultMessage: 'Pass',
          })}
        </button>
        <button
          type='button'
          data-testid={`verdict-sendback-${idSuffix}`}
          aria-expanded={sendBack}
          disabled={submitting}
          onClick={() => setSendBack(s => !s)}
          className='rounded-sm border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-50'
        >
          {intl.formatMessage({
            id: 'acceptance.verdict.sendBack',
            defaultMessage: 'Send back',
          })}
        </button>
        {secondary ? (
          <button
            type='button'
            onClick={() => {
              setOpen(false)
              setSendBack(false)
            }}
            className='text-[11px] text-muted-foreground/70 hover:underline'
          >
            {intl.formatMessage({
              id: 'common.cancel',
              defaultMessage: 'Cancel',
            })}
          </button>
        ) : null}
      </div>
      {sendBack ? (
        <div className='flex flex-col gap-1'>
          <textarea
            data-testid={`verdict-note-${idSuffix}`}
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            placeholder={intl.formatMessage({
              id: 'acceptance.verdict.notePlaceholder',
              defaultMessage: 'Why is this sent back? (optional)',
            })}
            className='w-full rounded-md border border-input bg-background px-2 py-1 text-[11px]'
          />
          <button
            type='button'
            data-testid={`verdict-confirm-${idSuffix}`}
            disabled={submitting}
            onClick={() =>
              onVerdict('FAIL', criterionIds, note.trim() || undefined)
            }
            className='self-start rounded-sm bg-danger-subtle border border-danger-border px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-danger-subtle/70 disabled:opacity-50'
          >
            {intl.formatMessage({
              id: 'acceptance.verdict.confirmSendBack',
              defaultMessage: 'Confirm send-back',
            })}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function CriterionRow({
  c,
  interactive,
  submitting,
  onVerdict,
  editable = false,
  onSaveStatement,
  onDelete,
  mutating = false,
}: {
  c: TaskStatusCriterionView
  interactive: boolean
  submitting: boolean
  onVerdict: SubmitVerdict
  editable?: boolean
  onSaveStatement?: (id: string, statement: string) => void
  onDelete?: (id: string) => void
  mutating?: boolean
}) {
  const intl = useIntl()
  const [showCheck, setShowCheck] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(c.statement)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const v = c.latestVerdict
  const badge = resultBadge(c, intl)
  const exitCode = parseExitCode(v?.evidencePointer)
  // Only MACHINE criteria carry a runnable check / evidence to disclose.
  const hasCheck = c.verifierType === 'MACHINE' && (!!c.checkpointer || !!v)
  // A machine-passed criterion gets the de-emphasized override affordance; an
  // unjudged or HUMAN row gets the prominent pass / send-back controls.
  const machinePassed = c.verifierType === 'MACHINE' && isPass(v?.verdict)
  const hasEditDisclosure = c.changeState === 'edited' && !!c.lastEdit

  return (
    <div className='flex gap-3 px-3 py-3 border-t border-border/60 first:border-t-0'>
      <span className='mt-0.5'>
        <VerdictGlyph verdict={v?.verdict ?? ''} />
      </span>
      <div className='min-w-0 flex-1'>
        {editing ? (
          <div>
            <textarea
              aria-label='Edit criterion statement'
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className='w-full rounded-md border border-border bg-background px-2 py-1 text-[13px]'
              rows={2}
            />
            <div className='mt-1 flex items-center gap-2'>
              <button
                type='button'
                disabled={
                  mutating ||
                  draft.trim() === '' ||
                  draft.trim() === c.statement
                }
                onClick={() => {
                  onSaveStatement?.(c.id, draft.trim())
                  setEditing(false)
                }}
                className='text-[11px] text-info hover:underline disabled:opacity-40'
              >
                {intl.formatMessage({
                  id: 'acceptance.edit.save',
                  defaultMessage: 'Save',
                })}
              </button>
              <button
                type='button'
                onClick={() => {
                  setDraft(c.statement)
                  setEditing(false)
                }}
                className='text-[11px] text-muted-foreground hover:underline'
              >
                {intl.formatMessage({
                  id: 'acceptance.edit.cancel',
                  defaultMessage: 'Cancel',
                })}
              </button>
            </div>
          </div>
        ) : (
          <div className='line-clamp-2 text-[13px] leading-snug text-foreground'>
            {c.statement}
          </div>
        )}
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
          {/* A — change-state markers */}
          {c.changeState === 'edited' ? (
            <span className='inline-flex items-center gap-1 rounded-sm bg-info-subtle border border-info-border px-1.5 py-0.5 font-medium text-foreground'>
              <Pencil className='size-3' aria-hidden />
              {c.changedAtRound != null
                ? intl.formatMessage(
                    {
                      id: 'acceptance.criterion.editedAtRound',
                      defaultMessage: 'Edited · round {round}',
                    },
                    { round: c.changedAtRound }
                  )
                : intl.formatMessage({
                    id: 'acceptance.criterion.edited',
                    defaultMessage: 'Edited',
                  })}
            </span>
          ) : null}
          {c.changeState === 'added' ? (
            <span className='inline-flex items-center gap-1 rounded-sm bg-info-subtle border border-info-border px-1.5 py-0.5 font-medium text-foreground'>
              {c.changedAtRound != null
                ? intl.formatMessage(
                    {
                      id: 'acceptance.criterion.addedAtRound',
                      defaultMessage: 'Added · round {round}',
                    },
                    { round: c.changedAtRound }
                  )
                : intl.formatMessage({
                    id: 'acceptance.criterion.added',
                    defaultMessage: 'Added',
                  })}
            </span>
          ) : null}
          {/* Disclosure buttons — pushed to the right as a group so they don't
              collide when both can appear on the same row. */}
          {editable || hasCheck || hasEditDisclosure ? (
            <div className='ml-auto flex items-center gap-2'>
              {editable && !editing ? (
                <>
                  <button
                    type='button'
                    aria-label='Edit criterion'
                    onClick={() => {
                      setDraft(c.statement)
                      setEditing(true)
                    }}
                    className='text-muted-foreground hover:text-foreground'
                  >
                    <Pencil className='size-3.5' aria-hidden />
                  </button>
                  <button
                    type='button'
                    aria-label='Delete criterion'
                    onClick={() => setConfirmDelete(true)}
                    className='text-muted-foreground hover:text-danger'
                  >
                    <Trash2 className='size-3.5' aria-hidden />
                  </button>
                </>
              ) : null}
              {hasEditDisclosure ? (
                <button
                  type='button'
                  aria-expanded={showEdit}
                  onClick={() => setShowEdit(s => !s)}
                  className='inline-flex items-center gap-0.5 text-info hover:underline text-[11px]'
                >
                  {showEdit
                    ? intl.formatMessage({
                        id: 'acceptance.criterion.hideChange',
                        defaultMessage: 'Hide change',
                      })
                    : intl.formatMessage({
                        id: 'acceptance.criterion.viewChange',
                        defaultMessage: 'View change',
                      })}
                  <ChevronRight
                    className={`size-3 transition-transform ${showEdit ? 'rotate-90' : ''}`}
                    aria-hidden
                  />
                </button>
              ) : null}
              {hasCheck ? (
                <button
                  type='button'
                  aria-expanded={showCheck}
                  onClick={() => setShowCheck(s => !s)}
                  className='inline-flex items-center gap-0.5 text-info hover:underline'
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
          ) : null}
        </div>
        {confirmDelete ? (
          <div className='mt-1.5 flex items-center gap-2 rounded-md border border-danger-border bg-danger-subtle px-2 py-1 text-[11px]'>
            <span className='text-danger'>
              {intl.formatMessage({
                id: 'acceptance.edit.confirmDelete',
                defaultMessage:
                  'Remove this criterion? Verdicts are kept for audit.',
              })}
            </span>
            <div className='ml-auto flex gap-2'>
              <button
                type='button'
                disabled={mutating}
                onClick={() => {
                  onDelete?.(c.id)
                  setConfirmDelete(false)
                }}
                className='text-danger hover:underline disabled:opacity-40'
              >
                {intl.formatMessage({
                  id: 'acceptance.edit.remove',
                  defaultMessage: 'Remove',
                })}
              </button>
              <button
                type='button'
                onClick={() => setConfirmDelete(false)}
                className='text-muted-foreground hover:underline'
              >
                {intl.formatMessage({
                  id: 'acceptance.edit.cancel',
                  defaultMessage: 'Cancel',
                })}
              </button>
            </div>
          </div>
        ) : null}
        {/* FAIL reason is part of the result — surfaced without a disclosure. */}
        {v?.verdict === 'FAIL' && v.rejectionReason ? (
          <div className='mt-1 text-[11px] text-danger break-words'>
            {v.rejectionReason}
          </div>
        ) : null}
        {/* B — edited old→new disclosure */}
        {hasEditDisclosure && showEdit ? (
          <div className='mt-1.5 rounded-md border border-border overflow-hidden text-[11px]'>
            <div className='flex gap-2 px-2 py-1'>
              <span className='text-danger'>−</span>
              <span className='line-through text-muted-foreground'>
                {c.lastEdit!.before}
              </span>
            </div>
            <div className='flex gap-2 px-2 py-1 border-t border-border text-foreground'>
              <span className='text-success'>+</span>
              <span>{c.lastEdit!.after}</span>
            </div>
          </div>
        ) : null}
        {hasCheck && showCheck ? (
          <div className='mt-1.5 space-y-0.5 rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[10px] text-muted-foreground'>
            {c.checkpointer ? (
              <div className='break-all'>
                <span className='text-muted-foreground/50'>$ </span>
                {c.checkpointer}
              </div>
            ) : null}
            {exitCode !== null ? (
              <div className={exitCode === 0 ? 'text-success' : 'text-danger'}>
                {exitCode === 0 ? '✓' : '✗'}{' '}
                {intl.formatMessage(
                  {
                    id: 'acceptance.check.exitCode',
                    defaultMessage: 'exit code {code}',
                  },
                  { code: exitCode }
                )}
              </div>
            ) : v?.evidencePointer ? (
              <div className='break-all'>{v.evidencePointer}</div>
            ) : (
              <div className='text-muted-foreground/60'>
                {intl.formatMessage({
                  id: 'acceptance.check.none',
                  defaultMessage: 'not yet run',
                })}
              </div>
            )}
          </div>
        ) : null}
        {interactive ? (
          <div className='mt-2'>
            <VerdictControls
              idSuffix={c.id}
              criterionIds={[c.id]}
              secondary={machinePassed}
              submitting={submitting}
              onVerdict={onVerdict}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── Add criterion row ─────────────────────────────────────────────────────────

function AddCriterionRow({
  onAdd,
  mutating,
}: {
  onAdd: (statement: string) => void
  mutating: boolean
}) {
  const intl = useIntl()
  const [text, setText] = useState('')
  const submit = () => {
    const s = text.trim()
    if (!s) return
    onAdd(s)
    setText('')
  }
  return (
    <div className='mt-2 flex items-center gap-2'>
      <input
        type='text'
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
        }}
        placeholder={intl.formatMessage({
          id: 'acceptance.edit.addPlaceholder',
          defaultMessage:
            'Add a criterion needing human judgment (statement only)',
        })}
        className='flex-1 rounded-md border border-border bg-background px-2 py-1 text-[13px]'
      />
      <button
        type='button'
        disabled={mutating || text.trim() === ''}
        onClick={submit}
        className='rounded-md border border-info-border px-2 py-1 text-[11px] font-medium text-info disabled:opacity-40'
      >
        {intl.formatMessage({
          id: 'acceptance.edit.add',
          defaultMessage: 'Add',
        })}
      </button>
    </div>
  )
}

// ── Tab ──────────────────────────────────────────────────────────────────────

export function AcceptanceTab({
  taskIdentifier,
  enabled,
  workspaceUrl = '',
  members = [],
  agentActors = [],
}: AcceptanceTabProps) {
  const intl = useIntl()
  const { data, loading, error, refresh } = useTaskStatus({
    identifier: taskIdentifier,
    enabled,
  })
  const [submitting, setSubmitting] = useState(false)
  const [removedOpen, setRemovedOpen] = useState(false)
  const [mutating, setMutating] = useState(false)

  // The acceptance tab is only ever rendered inside the Clerk web UI — the
  // agent/CLI has no DOM — so a viewer here is by construction a human. The
  // server still enforces the red line (bearer identities 403 before parse);
  // this is just the UI gate. Verdicts are only actionable while IN_REVIEW.
  const submitVerdict = useCallback<SubmitVerdict>(
    (verdict, criterionIds, note) => {
      setSubmitting(true)
      void tasksClient
        .submitHumanVerdict(taskIdentifier, {
          verdict,
          ...(criterionIds ? { criterionIds } : {}),
          ...(note ? { note } : {}),
        })
        .then(() => refresh?.())
        .finally(() => setSubmitting(false))
    },
    [taskIdentifier, refresh]
  )

  const reviseContract = useCallback(
    (items: CriteriaSetItemInput[]) => {
      setMutating(true)
      void tasksClient
        .reviseCriteria(taskIdentifier, items)
        .then(() => refresh?.())
        .finally(() => setMutating(false))
    },
    [taskIdentifier, refresh]
  )
  const editStatement = useCallback(
    (id: string, statement: string) => {
      if (!data) return
      reviseContract(
        toSetItems(data.criteria).map(i =>
          i.id === id ? { ...i, statement } : i
        )
      )
    },
    [data, reviseContract]
  )
  const deleteCriterion = useCallback(
    (id: string) => {
      if (!data) return
      reviseContract(toSetItems(data.criteria).filter(i => i.id !== id))
    },
    [data, reviseContract]
  )
  const addCriterion = useCallback(
    (statement: string) => {
      if (!data) return
      reviseContract([
        ...toSetItems(data.criteria),
        { statement, verifierType: 'HUMAN' },
      ])
    },
    [data, reviseContract]
  )

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
  // Inline human verdict controls only while the task awaits adjudication.
  const interactive = data.task.status === 'IN_REVIEW'

  const machineCriteria = data.criteria.filter(
    c => c.verifierType === 'MACHINE'
  )
  const humanCriteria = data.criteria.filter(c => c.verifierType === 'HUMAN')
  // Human contract editing is available unless the task is terminal.
  const canEdit = data.task.status !== 'DONE'

  return (
    <div className='space-y-5 py-1'>
      <VerdictBanner data={data} />

      <BoundaryCrossingsPanel
        taskIdentifier={taskIdentifier}
        enabled={enabled}
        workspaceUrl={workspaceUrl}
        members={members}
        agentActors={agentActors}
        onChanged={() => {
          void refresh?.()
        }}
      />

      <VerificationHistory data={data} />

      <div>
        <div className='mb-2 flex items-center gap-2'>
          <div className='text-xs font-medium text-muted-foreground'>
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
          {/* Task-level quick action (LUM-425 Fork 3) — pass / send back the
              whole contract in one click; per-criterion controls below are the
              addition, not a replacement. */}
          {interactive ? (
            <div className='ml-auto flex items-center gap-2'>
              <span className='text-[11px] text-muted-foreground/70'>
                {intl.formatMessage({
                  id: 'acceptance.verdict.allLabel',
                  defaultMessage: 'Whole contract:',
                })}
              </span>
              <VerdictControls
                idSuffix='all'
                criterionIds={undefined}
                secondary={false}
                submitting={submitting}
                onVerdict={submitVerdict}
              />
            </div>
          ) : null}
        </div>
        <div className='space-y-4'>
          {machineCriteria.length > 0 ? (
            <div>
              <div className='mb-1.5 text-[11px] font-medium text-muted-foreground'>
                {intl.formatMessage({
                  id: 'acceptance.zone.machine',
                  defaultMessage: 'Machine-verified · read-only',
                })}
              </div>
              <div className='overflow-hidden rounded-lg border border-border'>
                {machineCriteria.map(c => (
                  <CriterionRow
                    key={c.id}
                    c={c}
                    interactive={interactive}
                    submitting={submitting}
                    onVerdict={submitVerdict}
                    editable={false}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <div className='mb-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground'>
              {intl.formatMessage({
                id: 'acceptance.zone.human',
                defaultMessage: 'Needs human judgment',
              })}
              <span className='ml-auto text-muted-foreground/70'>
                {humanCriteria.length} / 7
              </span>
            </div>
            {humanCriteria.length > 0 ? (
              <div className='overflow-hidden rounded-lg border border-border'>
                {humanCriteria.map(c => (
                  <CriterionRow
                    key={c.id}
                    c={c}
                    interactive={interactive}
                    submitting={submitting}
                    onVerdict={submitVerdict}
                    editable={canEdit}
                    onSaveStatement={editStatement}
                    onDelete={deleteCriterion}
                    mutating={mutating}
                  />
                ))}
              </div>
            ) : null}
            {canEdit ? (
              <AddCriterionRow onAdd={addCriterion} mutating={mutating} />
            ) : null}
          </div>
        </div>
      </div>

      {/* C — Removed criteria section */}
      {data.removedCriteria.length > 0 ? (
        <div>
          <button
            type='button'
            onClick={() => setRemovedOpen(o => !o)}
            aria-expanded={removedOpen}
            className='mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground'
          >
            <Archive className='size-3.5' aria-hidden />
            {intl.formatMessage({
              id: 'acceptance.removed.title',
              defaultMessage: 'Removed · kept for audit',
            })}
            <span className='text-muted-foreground/70'>
              ({data.removedCriteria.length})
            </span>
            <ChevronRight
              className={`size-3.5 transition-transform ${removedOpen ? 'rotate-90' : ''}`}
              aria-hidden
            />
          </button>
          {removedOpen ? (
            <div className='overflow-hidden rounded-lg border border-border bg-muted/30'>
              {data.removedCriteria.map((rc: RemovedCriterionView) => (
                <div
                  key={rc.id}
                  className='flex gap-3 px-3 py-3 border-t border-border/60 first:border-t-0'
                >
                  <Trash2
                    className='mt-0.5 size-3.5 text-muted-foreground shrink-0'
                    aria-hidden
                  />
                  <div className='min-w-0 flex-1'>
                    <div className='text-[13px] leading-snug text-muted-foreground line-through'>
                      {rc.statement}
                    </div>
                    <div className='mt-1.5 flex flex-wrap gap-1.5 text-[11px]'>
                      {rc.removedAtRound != null ? (
                        <span className='rounded-sm border border-border px-1.5 py-0.5 font-medium text-muted-foreground'>
                          {intl.formatMessage(
                            {
                              id: 'acceptance.removed.atRound',
                              defaultMessage: 'Removed at round {round}',
                            },
                            { round: rc.removedAtRound }
                          )}
                        </span>
                      ) : null}
                      {rc.lastVerdict ? (
                        <span
                          className={`rounded-sm px-1.5 py-0.5 font-medium ${rc.lastVerdict.verdict === 'FAIL' ? 'bg-danger-subtle border border-danger-border text-foreground' : 'border border-border text-muted-foreground'}`}
                        >
                          {intl.formatMessage(
                            {
                              id: 'acceptance.removed.lastVerdict',
                              defaultMessage: 'last verdict: {v}',
                            },
                            { v: rc.lastVerdict.verdict }
                          )}
                        </span>
                      ) : null}
                      <span className='rounded-sm border border-border px-1.5 py-0.5 text-muted-foreground'>
                        {rc.verifierType}
                      </span>
                    </div>
                    {rc.runCount > 0 ? (
                      <div className='mt-1 text-[11px] italic text-muted-foreground/70'>
                        {intl.formatMessage(
                          {
                            id: 'acceptance.removed.runsPreserved',
                            defaultMessage: '{n} verification run(s) preserved',
                          },
                          { n: rc.runCount }
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
