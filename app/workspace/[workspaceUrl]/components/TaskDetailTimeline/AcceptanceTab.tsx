'use client'

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useIntl } from 'react-intl'
import {
  ClipboardCheck,
  AlertTriangle,
  ChevronRight,
  Pencil,
  Archive,
  Trash2,
  ScrollText,
  CheckCircle2,
  UserCheck,
} from 'lucide-react'
import { tasksClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
// LUM-789: zero-import so this 'use client' component never drags Prisma
// into the browser bundle — same rendering split the CLI/task-status nudge
// already use for "is this criterion a to-do".
import { isUnmetForDisplay } from '@/lib/acceptance/unmet-display'
import { effectiveReferentKind } from '@/shared/src/referent-kind'
import { useTaskStatus } from '../../hooks/useTaskStatus'
import { useBoundaryCrossings } from '../../hooks/useBoundaryCrossings'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
  VerificationHistoryRoundView,
  AcceptanceVerifier,
  WorkspaceMemberInfo,
  RemovedCriterionView,
  CriteriaSetItemInput,
} from '../../types'
import type { MentionSources } from '@/types/mention'
import { VerdictGlyph } from './items/AcceptanceBatchItem'
import { BoundaryCrossingsPanel } from './BoundaryCrossingsPanel'
import { BOUNDARY_CROSSINGS_ANCHOR } from './taskTabs'
import { EvidenceRef, deriveRepoWebUrl } from './evidence-ref'
import {
  StruggleTrailSection,
  TrendSection,
  STRUGGLE_TITLE,
  STRUGGLE_TIP,
} from './HonestReportSections'
import { RecordStatusStrip } from './RecordStatusStrip'
import { deriveRecordGaps } from './record-gaps'
import { RunReportTiles } from './RunReportTiles'
import { deriveRunReportTiles } from './run-report-tiles'
import { InfoTooltip } from './InfoTooltip'
import { ActionTooltip } from './ActionTooltip'
import { VerdictDecision, type HumanVerdictResult } from './VerdictDecision'
import {
  isPass,
  isHumanOverride,
  machineEvidenceVerdict,
  machineRollup,
} from './verdict-status'
import { roundHeadline } from './verification-history'

interface AcceptanceTabProps {
  taskIdentifier: string
  enabled: boolean
  /** Workspace URL slug, for linking a spawned remediation task from the panel. */
  workspaceUrl?: string
  /** For resolving the disposition reviewer's name on the crossings panel. */
  members?: WorkspaceMemberInfo[]
  agentActors?: { actorId: string; name: string }[]
  /** Bubbled up from the header VerdictDecision when a human verdict lands. */
  onVerdictRecorded: (result: HumanVerdictResult) => void
  /** Mention sources for the FAIL send-back editor in the verdict ritual. */
  mentionSources?: MentionSources
  /** LUM-481 — latest run summary, surfaced on the header verdict card. */
  latestRunSummary?: string | null
  /** LUM-572 — the dossier's evidence & causality sub-sections (agent runs,
   *  lineage, memory). Rendered at the tail of the Run report group so the whole
   *  after-the-fact record lives under one collapsible bucket. */
  evidenceSlot?: ReactNode
  /** LUM-619 — the mechanical gate audit panel, fetched at the dossier level and
   *  injected here so it renders in the Acceptance container's audit-only zone
   *  (alongside boundary crossings + claim-vs-verification) rather than buried
   *  in the Agent runs sub-section. Null when there are no PRs/signals. */
  gatesSlot?: ReactNode
  /** LUM-732: per-PR security scan findings; null when the task has no PRs. */
  securitySlot?: ReactNode
  /** LUM-496: how many undispositioned security findings hard-block DONE
   *  (`securityScans.blocking.count`, fetched at the dossier level next to the
   *  slot above). >0 moves `securitySlot` into the NEEDS ACTION zone; 0 (the
   *  default, i.e. "no security signal here") leaves it in the records. */
  securityBlocking?: number
  /** Open the Run report group on mount — e.g. a legacy deep link targets an
   *  evidence sub-section nested inside it. */
  reportInitiallyOpen?: boolean
}

/** Records a human verdict for a specific criterion (criterionIds identifies
 *  the criterion being adjudicated; currently only called per-criterion). */
type SubmitVerdict = (
  verdict: 'PASS' | 'FAIL',
  criterionIds?: string[],
  note?: string
) => void

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
    // Preserve agent-drafted judging guidance (LUM-465) across a statement-only
    // edit — the server full-replaces by id, so dropping it here would wipe it.
    ...(c.judgeSteps ? { judgeSteps: c.judgeSteps } : {}),
    // LUM-602: preserve the declared referent kind so a statement-only edit
    // does not wipe it — the server full-replaces by id.
    ...(c.referentKind ? { referentKind: c.referentKind } : {}),
  }))
}

/** LUM-496: the Run report group's initial fold state (see the tab body). */
const RUN_REPORT_OPEN_BY_DEFAULT = true

// ── Dossier group shell (LUM-581) ────────────────────────────────────────────
//
// The uniform card for a top-level Record-tab group (claim · criteria · run
// report · boundary all share this geometry). One border + radius + header
// rhythm so the four groups read as one family; the title carries the top
// hierarchy tier (text-title), a clear step above each group's inner
// sub-headers (text-body-strong) and body (text-body / caption).

function DossierGroup({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className='overflow-hidden rounded-lg border border-border'>
      <button
        type='button'
        onClick={onToggle}
        aria-expanded={open}
        className='flex w-full items-center gap-2 px-4 py-3 text-left text-title text-foreground transition-colors hover:bg-muted/40'
      >
        <ChevronRight
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        />
        {title}
      </button>
      {open ? (
        <div className='border-t border-border px-4 py-4'>{children}</div>
      ) : null}
    </div>
  )
}

// ── Verification record (round history) ──────────────────────────────────────

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

  const roundLabel = (
    r: VerificationHistoryRoundView,
    v: AcceptanceVerifier | null
  ): string => {
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
      <div className='mb-2 flex items-center gap-1 text-body-strong text-foreground'>
        {intl.formatMessage({
          id: 'acceptance.history.title',
          defaultMessage: 'Verification record',
        })}
        <InfoTooltip
          label={intl.formatMessage({
            id: 'acceptance.history.tip',
            defaultMessage:
              'Each round is one verification pass. MACHINE = checkpointer run, HUMAN = person verdict, AGENT = agent sent the task back.',
          })}
        />
      </div>
      <div className='overflow-hidden rounded-md border border-border'>
        {rounds.map((r, i) => {
          const expanded = open.has(r.round)
          const headline = roundHeadline(r)
          const tonePass = headline.tonePass
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
                <span className='text-xs text-foreground'>
                  {roundLabel(r, headline.verifier)}
                </span>
                <span
                  className={`rounded-sm px-1.5 text-[11px] font-medium ${
                    tonePass
                      ? 'bg-success-subtle border border-success-border text-foreground'
                      : 'bg-danger-subtle border border-danger-border text-foreground'
                  }`}
                >
                  {headline.isSendBackOnly
                    ? intl.formatMessage(
                        {
                          id: 'acceptance.history.sendBackCount',
                          defaultMessage:
                            '{count, plural, one {# sent back} other {# sent back}}',
                        },
                        { count: headline.sendBackCount }
                      )
                    : intl.formatMessage(
                        {
                          id: 'acceptance.history.passCount',
                          defaultMessage: '{passed}/{total} passed',
                        },
                        { passed: headline.passed, total: headline.total }
                      )}
                </span>
                <span className='ml-auto text-[11px] text-muted-foreground'>
                  {new Date(r.recordedAt).toLocaleString(intl.locale)}
                </span>
              </button>
              {!headline.isSendBackOnly && headline.sendBackCount > 0 ? (
                <div className='flex items-center gap-1.5 px-3 pb-2.5 pl-8 -mt-1 text-[11px] text-danger'>
                  <span aria-hidden>↳</span>
                  <span>
                    {intl.formatMessage(
                      {
                        id: 'acceptance.history.sendBackInline',
                        defaultMessage:
                          '{count, plural, one {agent send-back · #} other {agent send-back · #}}',
                      },
                      { count: headline.sendBackCount }
                    )}
                  </span>
                </div>
              ) : null}
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
                      <span
                        className={`min-w-0 flex-1 ${v.withdrawn ? 'line-through opacity-60' : ''}`}
                      >
                        {statementById.get(v.criterionId) ?? v.criterionId}
                        {v.verdict === 'FAIL' && v.rejectionReason ? (
                          <span className='text-danger'>
                            {' '}
                            — {v.rejectionReason}
                          </span>
                        ) : null}
                      </span>
                      {/* LUM-586: badge withdrawn human verdicts */}
                      {v.withdrawn ? (
                        <span className='shrink-0 rounded-sm border border-border px-1 py-0.5 text-[10px] text-muted-foreground/70'>
                          {intl.formatMessage({
                            id: 'task.verdict.historyWithdrawn',
                          })}
                        </span>
                      ) : null}
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
// Used per-criterion only (criterionIds = [c.id]); the whole-contract task-level
// call site was removed in the acceptance tab redesign.
// `secondary` collapses the controls behind an unobtrusive "Override" toggle —
// used on machine-passed rows so a human doesn't fat-finger overturning a green
// machine result, while still allowing the red line's provable manual override.

function VerdictControls({
  idSuffix,
  criterionIds,
  secondary,
  submitting,
  onVerdict,
  overrideConfirm = false,
}: {
  idSuffix: string
  criterionIds: string[] | undefined
  secondary: boolean
  submitting: boolean
  onVerdict: SubmitVerdict
  /** When true, a PASS overrides a MACHINE criterion no checkpointer has
   *  passed — gate it behind an explicit confirmation (LUM-456). */
  overrideConfirm?: boolean
}) {
  const intl = useIntl()
  const [open, setOpen] = useState(!secondary)
  const [sendBack, setSendBack] = useState(false)
  const [note, setNote] = useState('')
  const [confirmOverride, setConfirmOverride] = useState(false)

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
        <ActionTooltip
          tip={intl.formatMessage({
            id: 'acceptance.verdict.passTip',
            defaultMessage: 'Mark this criterion met.',
          })}
        >
          <button
            type='button'
            data-testid={`verdict-pass-${idSuffix}`}
            disabled={submitting}
            onClick={() =>
              overrideConfirm
                ? setConfirmOverride(true)
                : onVerdict('PASS', criterionIds)
            }
            className={`${passCls} disabled:opacity-50`}
          >
            {intl.formatMessage({
              id: 'acceptance.verdict.pass',
              defaultMessage: 'Pass',
            })}
          </button>
        </ActionTooltip>
        <ActionTooltip
          tip={intl.formatMessage({
            id: 'acceptance.verdict.sendBackTip',
            defaultMessage:
              'Reject this criterion and send the task back to the agent for another round.',
          })}
        >
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
        </ActionTooltip>
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
      {/* LUM-456: passing a MACHINE criterion no checkpointer has passed is an
          override of the machine's authority — make the human own it. */}
      {confirmOverride ? (
        <div
          data-testid={`verdict-override-confirm-${idSuffix}`}
          className='flex flex-col gap-1.5 rounded-md border border-warning-border bg-warning-subtle px-2 py-1.5'
        >
          <div className='flex items-start gap-1.5 text-[11px] text-foreground'>
            <AlertTriangle
              className='mt-0.5 size-3 shrink-0 text-warning'
              aria-hidden
            />
            <span>
              {intl.formatMessage({
                id: 'acceptance.verdict.overrideWarning',
                defaultMessage:
                  "This check's checkpointer has not passed — passing it records a human override, not machine verification.",
              })}
            </span>
          </div>
          <div className='flex items-center gap-1.5'>
            <button
              type='button'
              data-testid={`verdict-override-go-${idSuffix}`}
              disabled={submitting}
              onClick={() => {
                onVerdict('PASS', criterionIds)
                setConfirmOverride(false)
              }}
              className='rounded-sm bg-warning-subtle border border-warning-border px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-warning-subtle/70 disabled:opacity-50'
            >
              {intl.formatMessage({
                id: 'acceptance.verdict.overrideConfirm',
                defaultMessage: 'Override anyway',
              })}
            </button>
            <button
              type='button'
              onClick={() => setConfirmOverride(false)}
              className='text-[11px] text-muted-foreground/70 hover:underline'
            >
              {intl.formatMessage({
                id: 'common.cancel',
                defaultMessage: 'Cancel',
              })}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ── judgeSteps (LUM-465) ──────────────────────────────────────────────────────
//
// Agent-drafted human-judging guidance rendered on the adjudication card: a
// readable step block with clickable URLs, or a fallback hint when none was
// drafted. Only HUMAN criteria are judged by hand, so MACHINE rows render
// nothing. Light linkification only — no markdown engine (the guidance is short
// where-to-look / what-to-do / pass-vs-send-back prose, LUM-465).

const URL_PATTERN = /(https?:\/\/[^\s]+)/g

function linkifyJudgeSteps(text: string): React.ReactNode[] {
  return text.split(URL_PATTERN).map((part, i) => {
    if (!/^https?:\/\//.test(part)) return <span key={i}>{part}</span>
    // Don't let trailing sentence punctuation ("…/x.") leak into the href —
    // peel it off and render it as plain text after the link.
    const m = part.match(/^(.*?)([.,;:!?)\]]*)$/)!
    const url = m[1]
    const trail = m[2]
    return (
      <span key={i}>
        <a
          href={url}
          target='_blank'
          rel='noopener noreferrer'
          className='text-info hover:underline break-all'
        >
          {url}
        </a>
        {trail}
      </span>
    )
  })
}

function JudgeStepsBlock({ c }: { c: TaskStatusCriterionView }) {
  const intl = useIntl()
  if (c.verifierType !== 'HUMAN') return null
  if (!c.judgeSteps) {
    return (
      <div
        data-testid='judge-steps-missing'
        className='mt-1.5 text-[11px] italic text-muted-foreground/70'
      >
        {intl.formatMessage({
          id: 'acceptance.judge.missing',
          defaultMessage:
            'No judging guidance — add judgeSteps so the reviewer has steps, not just an assertion',
        })}
      </div>
    )
  }
  const lines = c.judgeSteps.split('\n').filter(l => l.trim() !== '')
  return (
    <div
      data-testid='judge-steps'
      className='mt-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5'
    >
      <div className='mb-0.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70'>
        {intl.formatMessage({
          id: 'acceptance.judge.label',
          defaultMessage: 'How to judge',
        })}
        <InfoTooltip
          label={intl.formatMessage({
            id: 'acceptance.judge.tip',
            defaultMessage:
              'Agent-drafted guidance for the human reviewer: where to look and what counts as pass or fail.',
          })}
        />
      </div>
      <div className='space-y-0.5 text-[11px] text-foreground break-words'>
        {lines.map((line, i) => (
          <div key={i}>{linkifyJudgeSteps(line)}</div>
        ))}
      </div>
    </div>
  )
}

/** LUM-496: the criterion's provenance, spelled out for the NEEDS ACTION
 *  machine card's "MACHINE · Agent-constructed" chip. AGENT_DRAFT is the
 *  default (and the label for anything unrecognised). */
function machineSourceLabel(
  source: string,
  intl: ReturnType<typeof useIntl>
): string {
  if (source === 'HUMAN_EDIT')
    return intl.formatMessage({
      id: 'record.machine.source.human',
      defaultMessage: 'Human-edited',
    })
  if (source === 'REVIEW_ADDED')
    return intl.formatMessage({
      id: 'record.machine.source.review',
      defaultMessage: 'Review-added',
    })
  return intl.formatMessage({
    id: 'record.machine.source.agent',
    defaultMessage: 'Agent-constructed',
  })
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
  repoWebUrl = null,
  awaiting = false,
}: {
  c: TaskStatusCriterionView
  interactive: boolean
  submitting: boolean
  onVerdict: SubmitVerdict
  editable?: boolean
  onSaveStatement?: (id: string, statement: string) => void | Promise<unknown>
  onDelete?: (id: string) => void
  mutating?: boolean
  /** Repo web base for drilling a `commit:` evidence pointer into a URL (LUM-563). */
  repoWebUrl?: string | null
  /** LUM-496: the row is listed in the NEEDS ACTION machine card — it wears the
   *  "Awaiting verification" chip, spells its provenance out ("MACHINE ·
   *  Agent-constructed") and labels the existing evidence disclosure "View
   *  output". Nothing else about the row changes. */
  awaiting?: boolean
}) {
  const intl = useIntl()
  const [showCheck, setShowCheck] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(c.statement)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const v = c.latestVerdict
  // LUM-611: a checkpointer run still vouches for this criterion even when a
  // later human PASS overrode the latest verdict — that machine round (round +
  // `cmd:` evidence) is what we disclose, not the evidence-less HUMAN verdict.
  const machineEv = machineEvidenceVerdict(c)
  // The evidence pointer to surface: the machine round's when one vouches,
  // otherwise whatever the latest verdict carries.
  const evidencePointer =
    machineEv?.evidencePointer ?? v?.evidencePointer ?? null
  const badge = resultBadge(c, intl)
  // LUM-602: compute effective referent kind only when declared (null → no badge).
  const effKind =
    c.referentKind != null
      ? effectiveReferentKind({
          declared: c.referentKind,
          verifierType: c.verifierType,
          checkpointer: c.checkpointer,
        })
      : null
  // LUM-563/566: a criterion requiring proof but carrying no evidence pointer is
  // explicitly "pending" rather than silently bare. MACHINE pending is stated in
  // its disclosure; HUMAN rows have no disclosure, so flag it inline. LUM-611: a
  // machine round's evidence counts even after a human override, so consult the
  // resolved pointer, not just the latest verdict's.
  const evidencePending = c.evidenceRequired && !evidencePointer
  // Only MACHINE criteria carry a runnable check / evidence to disclose.
  const hasCheck = c.verifierType === 'MACHINE' && (!!c.checkpointer || !!v)
  // A checkpointer-verified criterion gets the de-emphasized override affordance;
  // an unjudged, overridden, or HUMAN row gets the prominent controls. LUM-611:
  // use the read model's machinePassed (a checkpointer actually vouches), not a
  // local re-derivation that would also flag a human override as machine-passed.
  const machinePassed = c.machinePassed
  const hasEditDisclosure = c.changeState === 'edited' && !!c.lastEdit
  // LUM-457: a PASS that vouches for a pre-edit version — the criterion changed
  // after this verdict, or its machine evidence ran a different command than the
  // current checkpointer. Render-only downgrade; the criterion still counts met.
  const stalePass = isPass(v?.verdict) && (c.verdictStale || c.checkMismatch)

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
            {saveError ? (
              <div className='mt-0.5 text-danger text-[11px]'>
                {intl.formatMessage({
                  id: 'acceptance.edit.saveError',
                  defaultMessage: "Couldn't save — try again",
                })}
              </div>
            ) : null}
            <div className='mt-1 flex items-center gap-2'>
              <button
                type='button'
                disabled={
                  mutating ||
                  draft.trim() === '' ||
                  draft.trim() === c.statement
                }
                onClick={async () => {
                  setSaveError(false)
                  try {
                    await onSaveStatement?.(c.id, draft.trim())
                    setEditing(false)
                  } catch {
                    setSaveError(true)
                  }
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
                  setSaveError(false)
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
          {/* LUM-496: in the NEEDS ACTION card the honest state badge (Failed /
              Passed-by-override) is kept and joined by the explicit "Awaiting
              verification" chip — a machine check that no checkpointer has
              passed is still awaiting, whatever the latest verdict says. An
              unjudged row already reads "Awaiting verification", so it carries
              that chip alone rather than the same words twice. */}
          {awaiting && v ? (
            <span
              className={`rounded-sm px-1.5 py-0.5 font-medium ${badge.cls}`}
            >
              {badge.label}
            </span>
          ) : null}
          {awaiting ? (
            <span
              data-testid={`machine-awaiting-${c.id}`}
              className='rounded-sm bg-warning-subtle border border-warning-border px-1.5 py-0.5 font-medium text-foreground'
            >
              {intl.formatMessage({
                id: 'record.machine.awaiting',
                defaultMessage: 'Awaiting verification',
              })}
            </span>
          ) : (
            <span
              className={`rounded-sm px-1.5 py-0.5 font-medium ${badge.cls}`}
            >
              {badge.label}
            </span>
          )}
          {/* LUM-457 — downgrade marker: a pass against a pre-edit version. */}
          {stalePass ? (
            <span
              data-testid='stale-marker'
              className='inline-flex items-center gap-1 rounded-sm bg-warning-subtle border border-warning-border px-1.5 py-0.5 font-medium text-foreground'
            >
              <AlertTriangle className='size-3' aria-hidden />
              {intl.formatMessage({
                id: 'acceptance.criterion.staleVerdict',
                defaultMessage: 'Passed · pre-edit version',
              })}
              <InfoTooltip
                label={intl.formatMessage({
                  id: 'acceptance.criterion.staleTip',
                  defaultMessage:
                    'This passed against an earlier version of the criterion. Re-run lumo verify to re-confirm.',
                })}
              />
            </span>
          ) : null}
          <span className='rounded-sm border border-border px-1.5 py-0.5 text-muted-foreground'>
            {awaiting
              ? intl.formatMessage(
                  {
                    id: 'record.machine.source',
                    defaultMessage: 'MACHINE · {source}',
                  },
                  { source: machineSourceLabel(c.source, intl) }
                )
              : c.verifierType}
          </span>
          {/* LUM-602: referent kind badge — only when declared (null → no badge,
              matching CLI no-noise behavior for legacy rows). UNVERIFIED_ASSERTION
              is a warning: EXTERNAL_FACT claimed but checkpointer doesn't earn it. */}
          {effKind != null ? (
            effKind === 'UNVERIFIED_ASSERTION' ? (
              <span
                data-testid='referent-kind-badge'
                className='inline-flex items-center gap-1 rounded-sm bg-warning-subtle border border-warning-border px-1.5 py-0.5 font-medium text-foreground'
              >
                <AlertTriangle className='size-3' aria-hidden />
                {intl.formatMessage({
                  id: 'acceptance.referentKind.UNVERIFIED_ASSERTION',
                  defaultMessage: 'Unverified',
                })}
              </span>
            ) : effKind === 'EXTERNAL_FACT' ? (
              <span
                data-testid='referent-kind-badge'
                className='rounded-sm border border-border px-1.5 py-0.5 text-muted-foreground'
              >
                {intl.formatMessage({
                  id: 'acceptance.referentKind.EXTERNAL_FACT',
                  defaultMessage: 'External fact',
                })}
              </span>
            ) : effKind === 'AGENT_CONSTRUCTED_STATE' ? (
              <span
                data-testid='referent-kind-badge'
                className='rounded-sm border border-border px-1.5 py-0.5 text-muted-foreground'
              >
                {intl.formatMessage({
                  id: 'acceptance.referentKind.AGENT_CONSTRUCTED_STATE',
                  defaultMessage: 'Agent-constructed',
                })}
              </span>
            ) : effKind === 'PENDING_OUTCOME' ? (
              <span
                data-testid='referent-kind-badge'
                className='rounded-sm border border-border px-1.5 py-0.5 text-muted-foreground'
              >
                {intl.formatMessage({
                  id: 'acceptance.referentKind.PENDING_OUTCOME',
                  defaultMessage: 'Pending outcome',
                })}
              </span>
            ) : null
          ) : null}
          {/* Provenance only when notable — AGENT_DRAFT is the silent default.
              In the awaiting variant the provenance already rides on the
              "MACHINE · …" chip above, so this pill would repeat it. */}
          {c.source !== 'AGENT_DRAFT' && !awaiting ? (
            <span
              className={`rounded-sm px-1.5 py-0.5 font-medium ${SOURCE_PILL[c.source] ?? 'border border-border text-muted-foreground'}`}
            >
              {c.source}
            </span>
          ) : null}
          {isHumanOverride(c) ? (
            <span className='inline-flex items-center gap-1 rounded-sm bg-success-subtle border border-success-border px-1.5 py-0.5 font-medium text-foreground'>
              {intl.formatMessage({
                id: 'acceptance.tab.humanOverride',
                defaultMessage: 'human override',
              })}
              <InfoTooltip
                label={intl.formatMessage({
                  id: 'acceptance.tab.humanOverrideBadgeTip',
                  defaultMessage:
                    'A person marked this criterion passed without a machine check confirming it.',
                })}
              />
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
                    : awaiting
                      ? // LUM-496: the NEEDS ACTION card's "View output ›"
                        // affordance IS this disclosure — same toggle, the
                        // mockup's wording.
                        intl.formatMessage({
                          id: 'record.machine.viewOutput',
                          defaultMessage: 'View output',
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
        {/* LUM-566: a HUMAN criterion needing proof but carrying none has no
            disclosure to tuck the state into — flag "evidence pending" inline so
            the required-evidence promise isn't silently unmet. */}
        {evidencePending && !hasCheck ? (
          <div className='mt-1 text-[11px] italic text-muted-foreground/70'>
            {intl.formatMessage({
              id: 'acceptance.check.pending',
              defaultMessage: 'Evidence pending — no reference recorded yet',
            })}
          </div>
        ) : null}
        {/* LUM-457 — visible re-run hint for a stale / mismatched pass. */}
        {stalePass ? (
          <div className='mt-1 text-[11px] text-warning break-words'>
            {intl.formatMessage({
              id: 'acceptance.criterion.staleHint',
              defaultMessage:
                'Criterion changed since this check — re-run lumo verify to re-confirm',
            })}
          </div>
        ) : null}
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
        {/* LUM-511 Phase 5 — send-back lifecycle: resolved (with closing PR) / open. */}
        {c.sendBackResolution ? (
          <div className='mt-1 text-[11px] text-muted-foreground'>
            {c.sendBackResolution.status === 'resolved' ? (
              <>
                {intl.formatMessage(
                  {
                    id: 'acceptance.sendBack.resolved',
                    defaultMessage:
                      'Send-back (round {failed}) resolved in round {resolved}',
                  },
                  {
                    failed: c.sendBackResolution.failedAtRound,
                    resolved: c.sendBackResolution.resolvedAtRound,
                  }
                )}
                {c.sendBackResolution.closingPrNumber ? (
                  <>
                    {' · '}
                    {c.sendBackResolution.closingPrUrl ? (
                      <a
                        href={c.sendBackResolution.closingPrUrl}
                        target='_blank'
                        rel='noreferrer'
                        className='text-info hover:underline'
                      >
                        {intl.formatMessage(
                          {
                            id: 'acceptance.sendBack.pr',
                            defaultMessage: 'PR #{number}',
                          },
                          { number: c.sendBackResolution.closingPrNumber }
                        )}
                      </a>
                    ) : (
                      intl.formatMessage(
                        {
                          id: 'acceptance.sendBack.pr',
                          defaultMessage: 'PR #{number}',
                        },
                        { number: c.sendBackResolution.closingPrNumber }
                      )
                    )}
                  </>
                ) : null}
              </>
            ) : (
              intl.formatMessage(
                {
                  id: 'acceptance.sendBack.open',
                  defaultMessage: 'Send-back open since round {failed}',
                },
                { failed: c.sendBackResolution.failedAtRound }
              )
            )}
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
            <div className='flex items-center gap-1 font-sans text-muted-foreground/70'>
              {intl.formatMessage({
                id: 'acceptance.check.label',
                defaultMessage: 'Evidence',
              })}
              <InfoTooltip
                label={intl.formatMessage({
                  id: 'acceptance.check.tip',
                  defaultMessage:
                    'The command (checkpointer) that was run to verify this criterion, and its exit code. Exit 0 means it passed.',
                })}
              />
            </div>
            {c.checkpointer ? (
              <div className='break-all'>
                <span className='text-muted-foreground/50'>$ </span>
                {c.checkpointer}
              </div>
            ) : null}
            {/* LUM-611: when a checkpointer round vouches for this criterion,
                disclose that it is machine-verified and at which round — even if
                a later human PASS overrode the latest verdict. A human sign-off
                does not erase the machine evidence below it. */}
            {machineEv ? (
              <div
                data-testid='machine-verified-marker'
                className='font-sans text-success'
              >
                {intl.formatMessage(
                  {
                    id: 'acceptance.check.machineVerifiedAtRound',
                    defaultMessage: 'machine-verified · round {round}',
                  },
                  { round: machineEv.round }
                )}
              </div>
            ) : null}
            {/* LUM-563: drill the verdict's evidence into a navigable reference
                — a commit URL, a path:line locator, or the re-runnable command +
                exit — instead of the inert raw pointer. LUM-611: prefer the
                machine round's pointer so a human override never hides it. */}
            {evidencePointer ? (
              <div className='break-all font-sans'>
                <EvidenceRef
                  pointer={evidencePointer}
                  repoWebUrl={repoWebUrl}
                  idSuffix={c.id}
                />
              </div>
            ) : c.evidenceRequired ? (
              <div className='font-sans text-muted-foreground/60'>
                {intl.formatMessage({
                  id: 'acceptance.check.pending',
                  defaultMessage:
                    'Evidence pending — no reference recorded yet',
                })}
              </div>
            ) : isPass(v?.verdict) ? (
              // A pass carrying no machine evidence is a human override, not a
              // machine run — say so instead of the ambiguous "not yet run"
              // that read as "this check never ran" next to a PASS (LUM-457).
              <div className='text-muted-foreground/60'>
                {intl.formatMessage({
                  id: 'acceptance.check.overrideNoRun',
                  defaultMessage:
                    'No machine check ran — passed by human override',
                })}
              </div>
            ) : (
              <div className='text-muted-foreground/60'>
                {intl.formatMessage({
                  id: 'acceptance.check.none',
                  defaultMessage: 'Machine check not yet run',
                })}
              </div>
            )}
          </div>
        ) : null}
        {/* LUM-465: agent-drafted judging guidance, sitting right above the
            pass / send-back controls — the reviewer's reading order. */}
        <JudgeStepsBlock c={c} />
        {interactive ? (
          <div className='mt-2'>
            <VerdictControls
              idSuffix={c.id}
              criterionIds={[c.id]}
              secondary={machinePassed}
              submitting={submitting}
              onVerdict={onVerdict}
              overrideConfirm={c.verifierType === 'MACHINE' && !c.machinePassed}
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
  onVerdictRecorded,
  mentionSources,
  latestRunSummary,
  evidenceSlot,
  gatesSlot,
  securitySlot,
  securityBlocking = 0,
  reportInitiallyOpen = false,
}: AcceptanceTabProps) {
  const intl = useIntl()
  const { data, loading, error, refresh, optimisticallyPass } = useTaskStatus({
    identifier: taskIdentifier,
    enabled,
  })
  // LUM-496: the same react-query cache the crossings panel reads (one key →
  // one fetch), so the Done-gap strip and the zone split can be derived here
  // without lifting the fetch to the dossier. `gateEnabled` defaults to true —
  // an older response without the field must err toward "open blocks".
  const { crossings, gateEnabled = true } = useBoundaryCrossings({
    identifier: taskIdentifier,
    enabled,
  })
  const [submitting, setSubmitting] = useState(false)
  const [removedOpen, setRemovedOpen] = useState(false)
  // LUM-572: the trailing report sections (history / cost / struggle / trend /
  // removed) fold into one collapsed "Run report" group so the surface reads
  // decision → criteria → boundary, with the after-the-fact report tucked away.
  // LUM-496: the group opens by default — its KPI tiles are the record's
  // glanceable summary, with the narrative sub-sections collapsed inside it. A
  // legacy evidence deep link (`reportInitiallyOpen`) needs exactly that, so it
  // is satisfied by the same default; the prop stays part of the contract so a
  // future default flip can't silently break those URLs.
  const [runReportOpen, setRunReportOpen] = useState<boolean>(
    reportInitiallyOpen || RUN_REPORT_OPEN_BY_DEFAULT
  )
  // Machine zone fold (LUM-451). null = follow the smart default (collapsed when
  // every machine criterion passes); an explicit boolean is the user's toggle.
  const [machineOpen, setMachineOpen] = useState<boolean | null>(null)
  // LUM-572: the human zone folds on the same smart-default contract as the
  // machine zone — null = follow the default (collapsed once every human
  // criterion has a PASS); an explicit boolean is the user's manual toggle.
  const [humanOpen, setHumanOpen] = useState<boolean | null>(null)
  // LUM-619: the whole verdict region (criteria + verification record + the
  // audit-only forensic signals) lives in one collapsible "Acceptance"
  // container — default open (it's decision-relevant), foldable to taste.
  const [acceptanceOpen, setAcceptanceOpen] = useState(true)
  // LUM-620: the demoted "Evidence & audit trail" sub-card (verification
  // rounds + mechanical gates + run cost) — audit-only, collapsed by default
  // so the surface reads decision → criteria → claim, with the forensic
  // signals tucked one click away. (LUM-635: boundary crossings moved out —
  // an open crossing is an actionable Done-blocker, not forensics.)
  const [auditOpen, setAuditOpen] = useState(false)
  // LUM-496: the struggle trail folds behind its own heading inside the Run
  // report — the KPI tiles carry the headline numbers above it.
  const [struggleOpen, setStruggleOpen] = useState(false)
  const [mutating, setMutating] = useState(false)
  // LUM-789: the one-time "Confirm contract" POST. No optimistic update — the
  // button just disappears on the next refetch once every row carries a
  // confirmedAt, same as reviseContract's plain loading flag below.
  const [confirming, setConfirming] = useState(false)

  // The acceptance tab is only ever rendered inside the Clerk web UI — the
  // agent/CLI has no DOM — so a viewer here is by construction a human. The
  // server still enforces the red line (bearer identities 403 before parse);
  // this is just the UI gate. Verdicts are only actionable while IN_REVIEW.
  // LUM-613: a PASS flips the targeted row to a human PASS in the status cache
  // immediately (optimisticallyPass), so the reviewer gets instant feedback
  // instead of waiting on the POST plus a full refetch. We roll the cache back
  // if the request fails, and always refetch on settle so the server's
  // task-level effects (status → DONE, the new round, cost) win.
  const submitVerdict = useCallback<SubmitVerdict>(
    async (verdict, criterionIds, note) => {
      const rollback =
        verdict === 'PASS' ? optimisticallyPass?.(criterionIds) : undefined
      setSubmitting(true)
      try {
        await tasksClient.submitHumanVerdict(taskIdentifier, {
          verdict,
          ...(criterionIds ? { criterionIds } : {}),
          ...(note ? { note } : {}),
        })
      } catch (err) {
        rollback?.()
        throw err
      } finally {
        setSubmitting(false)
        void refresh?.()
      }
    },
    [taskIdentifier, refresh, optimisticallyPass]
  )

  // LUM-789: confirming records that a human agrees with what "done" means
  // here. It never touches task status and has no gate of its own — the
  // server route (`/criteria/confirm`) only ever stamps confirmedAt columns
  // and appends a CONTRACT_CONFIRMED activity, so this is a plain refetch,
  // not an optimistic flip like submitVerdict above.
  const confirmContract = useCallback(async () => {
    setConfirming(true)
    try {
      await tasksClient.confirmCriteria(taskIdentifier)
    } finally {
      setConfirming(false)
      void refresh?.()
    }
  }, [taskIdentifier, refresh])

  const reviseContract = useCallback(
    async (items: CriteriaSetItemInput[]) => {
      setMutating(true)
      try {
        await tasksClient.reviseCriteria(taskIdentifier, items)
        await refresh?.()
      } finally {
        setMutating(false)
      }
    },
    [taskIdentifier, refresh]
  )
  const editStatement = useCallback(
    (id: string, statement: string) => {
      if (!data) return
      return reviseContract(
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

  const emptyContractNote = (
    <div className='py-8 flex flex-col items-center gap-2 text-muted-foreground'>
      <ClipboardCheck className='size-6' />
      <p className='text-xs'>
        {intl.formatMessage({
          id: 'acceptance.tab.empty',
          defaultMessage: '此任务暂无验收标准',
        })}
      </p>
    </div>
  )

  if (!data) {
    return emptyContractNote
  }

  // LUM-600: the contract block (the contract-derived verdict status, the
  // welded claim/verification pairing, and the criteria zones) appears and
  // disappears as a unit with the contract. When there is no contract we no
  // longer short-circuit the whole dossier (the old LUM-520 early-return only
  // kept the boundary panel + empty note) — only the contract block is swapped
  // for the empty note; every contract-independent section (boundary crossings,
  // run report, the evidence slot) keeps rendering, so "本次运行 / agent runs /
  // lineage / cost" stay visible without a contract.
  const hasCriteria = data.criteria.length > 0

  // LUM-789: the badge's "still open" count — the tacit-pass rendering split
  // (Task 1), not the DONE-gate split. An un-adjudicated HUMAN criterion
  // reads as settled here; a genuinely unmet MACHINE criterion (or an
  // explicit HUMAN FAIL) still counts.
  const pendingCount = data.criteria.filter(c =>
    isUnmetForDisplay(c, c.latestVerdict ?? undefined)
  ).length
  const contractUnconfirmed = data.criteria.some(c => c.confirmedAt == null)

  // Inline human verdict controls only while the task awaits adjudication.
  const interactive = data.task.status === 'IN_REVIEW'
  // LUM-733: the human's default action is one whole-task Pass / Send back
  // (the header VerdictDecision). Per-criterion controls are only useful once a
  // send-back stands — to say WHICH criterion is still unmet — so the rows stay
  // passive until then (182 human verdict actions on record, 0 per-criterion
  // splits, 0 FAILs: the per-row controls were pure overhead on the happy path).
  const sendBackStanding = data.criteria.some(
    c => c.latestVerdict?.verdict === 'FAIL'
  )
  const rowInteractive = interactive && sendBackStanding

  // LUM-563: derive the repo web base from the task's synced PRs so a `commit:`
  // evidence pointer drills to a navigable URL; null → the renderer's git-show
  // fallback. Same-task, same-source as the struggle trail's PR list.
  const repoWebUrl = deriveRepoWebUrl(data.struggleTrail?.pullRequests)

  const machineCriteria = data.criteria.filter(
    c => c.verifierType === 'MACHINE'
  )
  const humanCriteria = data.criteria.filter(c => c.verifierType === 'HUMAN')
  // Human contract editing is available unless the task is terminal.
  const canEdit = data.task.status !== 'DONE'
  // LUM-456: split the machine zone honestly — only checkpointer-backed passes
  // are "machine-verified"; criteria a human is carrying are counted as
  // overrides, never folded into the verified tally.
  const machineStats = machineRollup(data.criteria)
  const machineVerified = machineStats.verified
  const machineOverridden = machineStats.overridden
  const machineFailed = machineStats.failed
  const allMachineVerified =
    machineCriteria.length > 0 && machineVerified === machineCriteria.length
  // LUM-496: the Machine-verified card is a RECORD in every state, so it starts
  // collapsed in every state. LUM-451's smart default ("expand when something
  // is unverified") is now carried by the zone split itself — an unverified
  // check sits, always visible, in the NEEDS ACTION card above, so expanding
  // the record card would only repeat what the reviewer already saw. The
  // header toggle still opens it on demand.
  const machineZoneOpen = machineOpen ?? false
  // LUM-572: mirror the smart default for the human zone — collapse once every
  // human criterion carries a PASS; any unresolved one keeps it open by default.
  const allHumanResolved =
    humanCriteria.length > 0 &&
    humanCriteria.every(c => isPass(c.latestVerdict?.verdict))
  const humanZoneOpen = humanOpen ?? !allHumanResolved
  // LUM-620 follow-up: the human zone reflects STATE, not a constant pending
  // magenta. While there are unresolved calls (and the task hasn't been
  // accepted) it wears the actionable in-review magenta; once every human
  // criterion is signed off — or the task is accepted (DONE) — it flips to a
  // resolved green so a Done task no longer reads as "still needs your
  // judgment". The task-level Approve marks the task DONE without necessarily
  // recording a per-criterion HUMAN verdict, so DONE alone resolves the zone.
  const humanUnresolvedCount = humanCriteria.filter(
    c => !isPass(c.latestVerdict?.verdict)
  ).length
  const taskAccepted = data.task.status === 'DONE'
  const humanPending =
    humanCriteria.length > 0 && humanUnresolvedCount > 0 && !taskAccepted
  const humanAllJudged = humanCriteria.length > 0 && !humanPending

  // ── LUM-496 · zone split ─────────────────────────────────────────────────
  //
  // Decision-first rule: a unit sits in NEEDS ACTION iff acting on it changes
  // whether the task can reach Done — machine checks no checkpointer has
  // passed, unjudged human calls, open boundary crossings, blocking security
  // findings. Everything else is a record. Membership is derived from the data
  // on every render (the same `deriveRecordGaps` the status strip reads), never
  // moved by hand.
  const gaps = deriveRecordGaps({
    data,
    crossings,
    gateEnabled,
    securityBlocking,
  })
  const isMachineVerified = (c: TaskStatusCriterionView) =>
    c.machinePassed && isPass(c.latestVerdict?.verdict)
  const machineVerifiedCriteria = machineCriteria.filter(isMachineVerified)
  // A DONE task has nothing left to act on (`gaps.machineAwaiting` is 0 for the
  // same reason): the unverified checks stop being a NEEDS ACTION card and join
  // the record card below, where the honest verified/total + override/failed
  // caption still says what a checkpointer actually passed.
  const machineAwaitingCriteria = taskAccepted
    ? []
    : machineCriteria.filter(c => !isMachineVerified(c))
  const machineRecordCriteria = taskAccepted
    ? machineCriteria
    : machineVerifiedCriteria
  const showSecurityFirst = gaps.securityBlocking > 0
  const hasNeedsAction =
    machineAwaitingCriteria.length > 0 ||
    humanPending ||
    gaps.crossingsOpen > 0 ||
    showSecurityFirst
  // The zone's note has to match what the zone actually contains (review
  // F4/F5). "Clear these and the task can be marked Done" is a lie on a task
  // already accepted (nothing here gates a decision that was taken), and an
  // overstatement when the only open items are advisory: they need a
  // disposition for the record, but Done never waited on them.
  const needsActionNoteId = gaps.taskDone
    ? 'record.zone.needsActionDoneNote'
    : gaps.crossingsOpen > 0 &&
        gaps.crossingsBlocking === 0 &&
        machineAwaitingCriteria.length === 0 &&
        !humanPending &&
        gaps.securityBlocking === 0
      ? 'record.zone.needsActionAdvisoryNote'
      : 'record.zone.needsActionNote'
  const needsActionNote = {
    'record.zone.needsActionDoneNote':
      'Open items recorded after the task was accepted.',
    'record.zone.needsActionAdvisoryNote':
      'These do not block Done, but each still needs a disposition.',
    'record.zone.needsActionNote':
      'Clear these and the task can be marked Done.',
  }[needsActionNoteId]

  // The human zone renders exactly once: pending → NEEDS ACTION, otherwise as
  // the resolved record below. It survives an empty human criteria list while
  // the contract is editable because it carries the add-criterion entry.
  const showHumanZone = humanCriteria.length > 0 || canEdit
  // …and with no human criterion yet it is exactly that: an empty shell whose
  // only content is the add-criterion entry. It gets its own header copy —
  // "Needs your judgment 0/0" claimed a pending call that does not exist.
  const humanEmptyShell = humanCriteria.length === 0

  // LUM-620's human zone markup, unchanged apart from the anchor it carries —
  // rendered in whichever zone its state puts it in.
  const humanZone = (anchorId?: string) => (
    <div
      id={anchorId}
      className={`overflow-hidden rounded-lg border ${
        humanPending
          ? 'border-status-in-review-border'
          : humanAllJudged
            ? 'border-success-border'
            : 'border-border'
      }`}
    >
      <button
        type='button'
        onClick={() => setHumanOpen(!humanZoneOpen)}
        aria-expanded={humanZoneOpen}
        className={`flex w-full items-center gap-2 border-b px-4 py-2.5 text-left ${
          humanPending
            ? 'border-status-in-review-border bg-status-in-review-subtle'
            : humanAllJudged
              ? 'border-success-border bg-success-subtle'
              : 'border-border bg-muted/30'
        }`}
      >
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${humanZoneOpen ? 'rotate-90' : ''}`}
          aria-hidden
        />
        {humanAllJudged ? (
          <CheckCircle2 className='size-4 shrink-0 text-success' aria-hidden />
        ) : (
          <UserCheck
            className={`size-4 shrink-0 ${humanPending ? 'text-status-in-review' : 'text-muted-foreground'}`}
            aria-hidden
          />
        )}
        <span className='text-body-strong text-foreground'>
          {humanEmptyShell
            ? intl.formatMessage({
                id: 'record.human.emptyTitle',
                defaultMessage: 'Human acceptance criteria',
              })
            : humanAllJudged
              ? intl.formatMessage({
                  id: 'acceptance.zone.humanResolved',
                  defaultMessage: 'Human-judged',
                })
              : intl.formatMessage({
                  id: 'acceptance.zone.human',
                  defaultMessage: 'Needs your judgment',
                })}
        </span>
        <span
          className={`text-caption ${
            humanPending
              ? 'text-status-in-review'
              : humanAllJudged
                ? 'text-success'
                : 'text-muted-foreground/70'
          }`}
        >
          {humanAllJudged
            ? intl.formatMessage(
                {
                  id: 'acceptance.zone.humanAllResolved',
                  defaultMessage: 'All {count} judged',
                },
                { count: humanCriteria.length }
              )
            : intl.formatMessage({
                id: 'acceptance.zone.humanNote',
                defaultMessage: 'not machine-checkable',
              })}
        </span>
        {/* An empty shell has nothing to count — "0/0" reads like a failure. */}
        {humanEmptyShell ? null : (
          <span className='ml-auto text-caption text-muted-foreground'>
            {humanCriteria.length - humanUnresolvedCount}/{humanCriteria.length}
          </span>
        )}
      </button>
      {humanZoneOpen ? (
        <div className='px-1 pb-1'>
          {humanCriteria.map(c => (
            <CriterionRow
              key={c.id}
              c={c}
              interactive={rowInteractive}
              submitting={submitting}
              onVerdict={submitVerdict}
              editable={canEdit}
              onSaveStatement={editStatement}
              onDelete={deleteCriterion}
              mutating={mutating}
              repoWebUrl={repoWebUrl}
            />
          ))}
          {canEdit ? (
            <div className='px-2 pb-1'>
              <AddCriterionRow onAdd={addCriterion} mutating={mutating} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )

  return (
    <div className='space-y-5 py-1'>
      {/* During IN_REVIEW the verdict is shown once, pinned, as the floating
          bar at the top of the task detail (above the description, via
          ReviewVerdictBar) — so the in-content header is suppressed here to
          avoid a second copy. Outside review there is no pending verdict to
          pin, so the header stays as the passive status banner (e.g. a DONE
          task's "passed" summary). */}
      {hasCriteria && !interactive && (
        <VerdictDecision
          variant='header'
          taskIdentifier={taskIdentifier}
          data={data}
          onVerdictRecorded={r => {
            onVerdictRecorded(r)
            void refresh?.()
          }}
          latestRunSummary={latestRunSummary}
          {...(mentionSources ? { mentionSources } : {})}
        />
      )}

      {/* LUM-789: the tacit-pass badge + the one-time "Confirm contract"
          affordance. Both live at the top of the contract block — the badge
          because it is the honest "still open" count (an un-adjudicated
          HUMAN row no longer inflates it), the button because confirming is
          optional, never gates Done, and disappears for good once every row
          carries a confirmedAt. */}
      {hasCriteria && (
        <div className='flex items-center gap-2'>
          <span
            data-testid='pending-count'
            className='text-caption text-muted-foreground'
          >
            {intl.formatMessage(
              {
                id: 'acceptance.pendingBadge',
                defaultMessage: '{count} pending',
              },
              { count: pendingCount }
            )}
          </span>
          {contractUnconfirmed && (
            <>
              <Button
                variant='outline'
                size='sm'
                onClick={() => void confirmContract()}
                disabled={confirming}
              >
                {intl.formatMessage({
                  id: 'acceptance.confirmContract',
                  defaultMessage: 'Confirm contract',
                })}
              </Button>
              <InfoTooltip
                label={intl.formatMessage({
                  id: 'acceptance.contractUnconfirmed',
                  defaultMessage:
                    'This contract has not been confirmed by a human yet. Confirming records that you agree with what "done" means here — it does not close the task.',
                })}
              />
            </>
          )}
        </div>
      )}

      {/* LUM-496: "still needed for Done", with anchor chips into each gap.
          The chips only link when the NEEDS ACTION zone (and therefore the
          anchors they point at) is actually on the page. */}
      <RecordStatusStrip gaps={gaps} interactive={hasNeedsAction} />

      {/* ── NEEDS ACTION ──────────────────────────────────────────────────
          Everything whose resolution moves the task toward Done. Rendered
          only when it has at least one child — a task with nothing left owes
          the reviewer no zone. */}
      {hasNeedsAction ? (
        <section data-testid='record-needs-action' className='space-y-3'>
          <div>
            <div className='text-body-strong text-foreground'>
              {intl.formatMessage({
                id: 'record.zone.needsAction',
                defaultMessage: 'Needs action',
              })}
            </div>
            <p
              data-testid='record-needs-action-note'
              className='text-caption text-muted-foreground'
            >
              {intl.formatMessage({
                id: needsActionNoteId,
                defaultMessage: needsActionNote,
              })}
            </p>
          </div>

          {/* Machine checks still awaiting a checkpointer pass (a human
              override counts as awaiting — honest per machineRollup). Only
              the awaiting rows are listed; the verified ones are a record. */}
          {machineAwaitingCriteria.length > 0 ? (
            <div
              id='record-machine'
              data-testid='record-machine-awaiting'
              className='overflow-hidden rounded-lg border border-warning-border'
            >
              <div className='flex w-full items-center gap-2 bg-warning-subtle px-4 py-2.5'>
                <AlertTriangle
                  className='size-4 shrink-0 text-warning'
                  aria-hidden
                />
                <span className='text-body-strong text-foreground'>
                  {intl.formatMessage({
                    id: 'record.machine.awaitingTitle',
                    defaultMessage: 'Machine checks awaiting verification',
                  })}
                </span>
                <span className='text-caption text-muted-foreground'>
                  {intl.formatMessage(
                    {
                      id: 'record.machine.awaitingSummary',
                      defaultMessage:
                        '{verified} verified · {awaiting} awaiting',
                    },
                    {
                      verified: gaps.machineVerified,
                      awaiting: gaps.machineAwaiting,
                    }
                  )}
                </span>
                <span className='ml-auto text-caption text-muted-foreground'>
                  {gaps.machineVerified}/{gaps.machineTotal}
                </span>
              </div>
              <div className='border-t border-border'>
                {machineAwaitingCriteria.map(c => (
                  <CriterionRow
                    key={c.id}
                    c={c}
                    interactive={rowInteractive}
                    submitting={submitting}
                    onVerdict={submitVerdict}
                    editable={false}
                    repoWebUrl={repoWebUrl}
                    awaiting
                  />
                ))}
              </div>
            </div>
          ) : null}

          {/* The human calls, while any is unjudged. */}
          {humanPending && showHumanZone ? humanZone('record-human') : null}

          {/* Open crossings — each needs a human disposition before Done.
              `legacyAnchorId` keeps the verdict bar's #boundary-crossings
              deep link (LUM-454) landing here. */}
          {gaps.crossingsOpen > 0 ? (
            <BoundaryCrossingsPanel
              taskIdentifier={taskIdentifier}
              enabled={enabled}
              workspaceUrl={workspaceUrl}
              members={members}
              agentActors={agentActors}
              onChanged={() => {
                void refresh?.()
              }}
              subset='open'
              anchorId='record-crossings'
              legacyAnchorId={BOUNDARY_CROSSINGS_ANCHOR}
            />
          ) : null}

          {/* LUM-732: an undispositioned blocking finding hard-blocks DONE
              (the API returns 409) — that is an action, not a record. Shown
              here instead of (never as well as) in the records below. */}
          {showSecurityFirst ? securitySlot : null}
        </section>
      ) : null}

      {/* ── RECORDS ───────────────────────────────────────────────────────
          Everything already settled: kept, legible, out of the way. */}
      <div data-testid='record-records' className='space-y-5'>
        <div className='flex items-center gap-2'>
          <span className='text-caption uppercase tracking-wide text-muted-foreground'>
            {intl.formatMessage({
              id: 'record.zone.records',
              defaultMessage: 'Records · no action needed',
            })}
          </span>
          <span className='h-px flex-1 bg-border' aria-hidden />
        </div>

        <DossierGroup
          title={intl.formatMessage({
            id: 'acceptance.container.title',
            defaultMessage: 'Acceptance',
          })}
          open={acceptanceOpen}
          onToggle={() => setAcceptanceOpen(o => !o)}
        >
          <div className='space-y-4'>
            {hasCriteria ? (
              <div className='space-y-3'>
                {/* The human zone in its resolved form (green, collapsed by
                    the LUM-572 smart default) — or, with no human criteria
                    yet, the editable shell carrying the add-criterion entry. */}
                {!humanPending && showHumanZone ? humanZone() : null}

                {/* LUM-620's machine-verified card: the checkpointer-backed
                    passes (plus, on a DONE task, the checks nobody is waiting
                    on any more) — a record, so collapsed by default. */}
                {machineRecordCriteria.length > 0 ? (
                  <div
                    className={`overflow-hidden rounded-lg border ${allMachineVerified ? 'border-success-border' : 'border-border'}`}
                  >
                    <button
                      type='button'
                      onClick={() => setMachineOpen(!machineZoneOpen)}
                      aria-expanded={machineZoneOpen}
                      className={`flex w-full items-center gap-2 px-4 py-2.5 text-left ${allMachineVerified ? 'bg-success-subtle' : 'bg-muted/30'}`}
                    >
                      <ChevronRight
                        className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${machineZoneOpen ? 'rotate-90' : ''}`}
                        aria-hidden
                      />
                      <CheckCircle2
                        className={`size-4 shrink-0 ${allMachineVerified ? 'text-success' : 'text-muted-foreground'}`}
                        aria-hidden
                      />
                      <span className='text-body-strong text-foreground'>
                        {intl.formatMessage({
                          id: 'acceptance.zone.machine',
                          defaultMessage: 'Machine-verified',
                        })}
                      </span>
                      <span
                        className={`text-caption ${allMachineVerified ? 'text-success' : 'text-muted-foreground/70'}`}
                      >
                        {allMachineVerified
                          ? intl.formatMessage(
                              {
                                id: 'acceptance.zone.machineAllPass',
                                defaultMessage: 'All {count} machine-verified',
                              },
                              { count: machineCriteria.length }
                            )
                          : [
                              intl.formatMessage(
                                {
                                  id: 'acceptance.zone.machineVerifiedCount',
                                  defaultMessage: '{count} machine-verified',
                                },
                                { count: machineVerified }
                              ),
                              machineOverridden > 0
                                ? intl.formatMessage(
                                    {
                                      id: 'acceptance.zone.machineOverrideCount',
                                      defaultMessage: '{count} human override',
                                    },
                                    { count: machineOverridden }
                                  )
                                : null,
                              machineFailed > 0
                                ? intl.formatMessage(
                                    {
                                      id: 'acceptance.zone.machineFailedCount',
                                      defaultMessage: '{count} failed',
                                    },
                                    { count: machineFailed }
                                  )
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                      </span>
                      <span className='ml-auto text-caption text-muted-foreground'>
                        {machineVerified}/{machineCriteria.length}
                      </span>
                    </button>
                    {machineZoneOpen ? (
                      <div className='border-t border-border'>
                        {machineRecordCriteria.map(c => (
                          <CriterionRow
                            key={c.id}
                            c={c}
                            interactive={rowInteractive}
                            submitting={submitting}
                            onVerdict={submitVerdict}
                            editable={false}
                            repoWebUrl={repoWebUrl}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              emptyContractNote
            )}

            {/* Crossings already ruled on — the record of who decided what.
                Renders null when there are none. It carries the legacy
                #boundary-crossings anchor whenever no open-subset panel is
                mounted above to carry it (never both — one id, one element). */}
            <BoundaryCrossingsPanel
              taskIdentifier={taskIdentifier}
              enabled={enabled}
              workspaceUrl={workspaceUrl}
              members={members}
              agentActors={agentActors}
              onChanged={() => {
                void refresh?.()
              }}
              subset='dispositioned'
              anchorId='record-crossings-dispositioned'
              {...(gaps.crossingsOpen === 0
                ? { legacyAnchorId: BOUNDARY_CROSSINGS_ANCHOR }
                : {})}
            />

            {/* LUM-620: Evidence & audit trail — the demoted, collapsed
                forensic zone: verification rounds + mechanical gates.
                Audit-only: none of it is an input to the verdict (LUM-614 red
                line). LUM-496: run cost left for the Run report's KPI tile. */}
            <div className='overflow-hidden rounded-lg border border-border bg-muted/20'>
              <button
                type='button'
                onClick={() => setAuditOpen(o => !o)}
                aria-expanded={auditOpen}
                className='flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40'
              >
                <ChevronRight
                  className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${auditOpen ? 'rotate-90' : ''}`}
                  aria-hidden
                />
                <ScrollText
                  className='size-4 shrink-0 text-muted-foreground'
                  aria-hidden
                />
                <span className='text-body-strong text-foreground'>
                  {intl.formatMessage({
                    id: 'acceptance.audit.title',
                    defaultMessage: 'Evidence & audit trail',
                  })}
                </span>
                <span
                  data-testid='audit-only-divider'
                  className='text-caption text-muted-foreground/70'
                >
                  {intl.formatMessage({
                    id: 'acceptance.auditOnly.label',
                    defaultMessage:
                      "Audit-only — these signals don't decide the verdict",
                  })}
                </span>
              </button>
              {auditOpen ? (
                <div className='space-y-4 border-t border-border px-4 py-4'>
                  {/* Verification record — how the verdict was reached. */}
                  <VerificationHistory data={data} />

                  {/* Mechanical gates (per PR; LUM-617). Injected from the
                      dossier level; null when there are no PRs/signals. */}
                  {gatesSlot}
                </div>
              ) : null}
            </div>
          </div>
        </DossierGroup>

        {/* LUM-732: the security scan as a record, when nothing in it blocks
            (a blocking finding puts it in NEEDS ACTION above instead). */}
        {showSecurityFirst ? null : securitySlot}

        {/* LUM-572 · Run report — the after-the-fact record. LUM-496: the four
            KPI tiles read at a glance; trend, struggle, removed and the
            evidence sub-sections stay one click away below them. */}
        <DossierGroup
          title={intl.formatMessage({
            id: 'acceptance.runReport.title',
            defaultMessage: 'Run report',
          })}
          open={runReportOpen}
          onToggle={() => setRunReportOpen(o => !o)}
        >
          <div className='space-y-4'>
            <RunReportTiles tiles={deriveRunReportTiles(data)} />

            <TrendSection data={data} />

            {/* LUM-561's struggle trail, folded — the tiles carry the headline
                numbers; the scars they summarize are one click below. */}
            {data.struggleTrail ? (
              <div className='overflow-hidden rounded-md border border-border'>
                <div className='flex items-center gap-1 px-1'>
                  <button
                    type='button'
                    aria-expanded={struggleOpen}
                    onClick={() => setStruggleOpen(o => !o)}
                    className='flex flex-1 items-center gap-2 px-2 py-2 text-left text-body-strong text-foreground'
                  >
                    <ChevronRight
                      className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${struggleOpen ? 'rotate-90' : ''}`}
                      aria-hidden
                    />
                    {intl.formatMessage(STRUGGLE_TITLE)}
                  </button>
                  <InfoTooltip label={intl.formatMessage(STRUGGLE_TIP)} />
                </div>
                {struggleOpen ? (
                  <div className='border-t border-border px-3 py-3'>
                    <StruggleTrailSection data={data} headless />
                  </div>
                ) : null}
              </div>
            ) : null}

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
                  <div className='overflow-hidden rounded-md border border-border bg-muted/30'>
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
                                  defaultMessage:
                                    '{n} verification run(s) preserved',
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

            {/* LUM-572: the evidence & causality sub-sections (agent runs,
                lineage, injected memory) fold in at the tail, so the whole
                after-the-fact record sits under one Run report group. */}
            {evidenceSlot}
          </div>
        </DossierGroup>
      </div>
    </div>
  )
}
