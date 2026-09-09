'use client'

import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Clock,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Undo2,
  UserCheck,
  CheckCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { tasksClient } from '@/lib/api-client'
// Imported from the concrete module (not the `@/lib/api-client` barrel) so the
// real class survives when a test mocks the barrel — instanceof stays meaningful.
import { ApiClientError } from '@/lib/api-client/base'
import { CommentEditor } from '../comments/CommentEditor'
import { ActionTooltip } from './ActionTooltip'
import { InfoTooltip } from './InfoTooltip'
import { useBoundaryCrossings } from '../../hooks/useBoundaryCrossings'
import { boundaryCategoryLabel } from './boundary-format'
import { BOUNDARY_CROSSINGS_ANCHOR, boundaryCrossingsHref } from './taskTabs'
import {
  deriveVerdictStatus,
  type VerdictTone,
  type VerdictStatusKind,
} from './verdict-status'
import type { TaskAcceptanceStatusView } from '../../types'
import type { MentionSources } from '@/types/mention'

type HumanVerdict = 'PASS' | 'FAIL'

export interface HumanVerdictResult {
  taskStatus: string
  verdict: HumanVerdict
}

interface VerdictDecisionProps {
  /**
   * Chrome only. `header` is the always-on status card rendered on the
   * acceptance tab (banner + the action ritual below it when IN_REVIEW).
   * `floating` is the compact bar rendered off the acceptance tab — it shows
   * only while the task is IN_REVIEW (there is nothing to adjudicate otherwise).
   * Both variants share the SAME verdict/gate logic; they differ only in layout.
   */
  variant: 'header' | 'floating'
  /** LUM-N — keys BOTH submitHumanVerdict and the boundary-crossings hook. */
  taskIdentifier: string
  data: TaskAcceptanceStatusView
  onVerdictRecorded: (result: HumanVerdictResult) => void
  /** Mention sources for the FAIL send-back editor (reuses the comment editor). */
  mentionSources?: MentionSources
  /**
   * LUM-481 — the latest run's one-line summary, surfaced on the `header`
   * variant only so a reviewer adjudicating at IN_REVIEW sees what the agent
   * did. Already resolved by the caller (LLM runSummary, else the digest line);
   * null/undefined renders nothing. The `floating` variant never shows it.
   */
  latestRunSummary?: string | null | undefined
}

// Status-banner chrome: status.kind → icon + title message id. Mirrors the
// (now-absorbed) AcceptanceTab VerdictBanner so the rendered output is identical.
const KIND_ICON = {
  escalated: AlertTriangle,
  sentBack: XCircle,
  done: CheckCircle2,
  doneNoHumanVerdict: CheckCircle2,
  allPassed: CheckCircle2,
  machineAwaitingHuman: CheckCircle2,
  inProgress: Clock,
} as const satisfies Record<VerdictStatusKind, typeof Clock>

const KIND_TITLE_ID = {
  escalated: 'acceptance.banner.escalated',
  sentBack: 'acceptance.banner.sentBack',
  done: 'acceptance.banner.done',
  doneNoHumanVerdict: 'acceptance.banner.doneNoHumanVerdict',
  allPassed: 'acceptance.banner.allPassed',
  machineAwaitingHuman: 'acceptance.banner.machineAwaitingHuman',
  inProgress: 'acceptance.banner.inProgress',
} as const satisfies Record<VerdictStatusKind, string>

const TONE_TEXT: Record<VerdictTone, string> = {
  success: 'text-success',
  danger: 'text-danger',
  neutral: 'text-muted-foreground',
}

// LUM-620 · Decision Hero chrome. The redesigned header verdict surface reads as
// one prominent card whose accent tells the state at a glance: a pending review
// wears the in-review magenta, an accepted task the success green, a sent-back
// task the warning amber. Derived from the status kind (not raw task.status) so
// it stays in lockstep with the banner title/tone already computed once.
type HeroState = 'pending' | 'accepted' | 'changes'

function heroStateOf(kind: VerdictStatusKind): HeroState {
  if (kind === 'sentBack' || kind === 'escalated') return 'changes'
  if (kind === 'done' || kind === 'doneNoHumanVerdict') return 'accepted'
  return 'pending'
}

const HERO_CARD: Record<HeroState, string> = {
  pending: 'border-status-in-review-border bg-status-in-review-subtle',
  accepted: 'border-success-border bg-success-subtle',
  changes: 'border-warning-border bg-warning-subtle',
}
const HERO_RING: Record<HeroState, string> = {
  pending: 'text-status-in-review',
  accepted: 'text-success',
  changes: 'text-warning',
}
const HERO_LABEL: Record<HeroState, string> = {
  pending: 'text-status-in-review',
  accepted: 'text-success',
  changes: 'text-warning',
}

/**
 * A compact SVG progress ring — the fraction of criteria met, at a glance. The
 * arc uses `currentColor` so the caller colors it via the hero accent; the
 * center reads "N/M" over a quiet "met" label. Purely presentational (no state,
 * pure render — safe under React's render-purity rule).
 */
function ProgressRing({
  met,
  total,
  className = '',
  metLabel,
}: {
  met: number
  total: number
  className?: string
  metLabel: string
}) {
  const r = 27
  const c = 2 * Math.PI * r
  const frac = total > 0 ? Math.min(1, Math.max(0, met / total)) : 0
  const offset = c * (1 - frac)
  return (
    <div className={`relative size-[66px] shrink-0 ${className}`} aria-hidden>
      <svg width='66' height='66' viewBox='0 0 66 66'>
        <circle
          cx='33'
          cy='33'
          r={r}
          fill='none'
          className='stroke-border'
          strokeWidth='6'
        />
        <circle
          cx='33'
          cy='33'
          r={r}
          fill='none'
          stroke='currentColor'
          strokeWidth='6'
          strokeLinecap='round'
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform='rotate(-90 33 33)'
        />
      </svg>
      <div className='absolute inset-0 flex flex-col items-center justify-center leading-none'>
        <span className='text-[17px] font-bold text-foreground'>
          {met}/{total}
        </span>
        <span className='mt-0.5 text-[8.5px] text-muted-foreground'>
          {metLabel}
        </span>
      </div>
    </div>
  )
}

/** Strip tags + whitespace to test whether a rich-text note has real content. */
function hasContent(html: string): boolean {
  return html.replace(/<[^>]+>/g, '').trim().length > 0
}

/**
 * The status-banner row (icon + title + met-line) shared by both chrome
 * variants. The two layouts differ only in icon size, met-line placement, and
 * whether the gate/round-badge ride alongside — so the row JSX lives here once
 * rather than being hand-copied per variant. `data-testid='verdict-status'`
 * stays on the row so the existing tests target it in either variant.
 */
function StatusBannerRow({
  layout,
  Icon,
  tone,
  title,
  metLine,
  gate,
  roundBadge,
}: {
  layout: 'header' | 'floating'
  Icon: typeof Clock
  tone: VerdictTone
  title: ReactNode
  metLine: ReactNode
  /** Header only: the gate line stacked under the met-line. */
  gate?: ReactNode
  /** Header only: the round badge rendered at the row's trailing edge. */
  roundBadge?: ReactNode
}) {
  if (layout === 'header') {
    return (
      <div data-testid='verdict-status' className='flex items-center gap-3'>
        <Icon className={`size-6 shrink-0 ${TONE_TEXT[tone]}`} aria-hidden />
        <div className='min-w-0 flex-1'>
          <div className='text-sm font-medium text-foreground'>{title}</div>
          <div className='mt-0.5 text-xs text-muted-foreground'>
            {metLine}
            {' · '}
            {gate}
          </div>
        </div>
        {roundBadge}
      </div>
    )
  }

  return (
    <div
      data-testid='verdict-status'
      className='flex min-w-0 flex-1 items-center gap-2'
    >
      <Icon className={`size-4 shrink-0 ${TONE_TEXT[tone]}`} aria-hidden />
      <span className='truncate text-body font-medium text-foreground'>
        {title}
      </span>
      <span className='shrink-0 text-caption text-muted-foreground'>
        {' · '}
        {metLine}
      </span>
    </div>
  )
}

/**
 * The single verdict surface (LUM-467): the always-on acceptance status banner
 * and the IN_REVIEW human-adjudication ritual merged into one component with two
 * chrome-only variants (`header` on the acceptance tab, `floating` off it),
 * rendered mutually-exclusively by the tab/timeline.
 *
 * The status banner derives entirely from `deriveVerdictStatus(data)` (LUM-456)
 * — one source of truth shared with the criterion rows. The action ritual is the
 * human-initiated entry point to the human-verdict write path (milestone rule 5:
 * agents/CLI can never reach it):
 *
 * The two actions are PASS (accept → Done) and FAIL (send back). LUM-422 ①
 * de-enumeration: a send-back carries ZERO structured burden — no
 * rejection-reason selector. FAIL opens the comment editor (markdown, @mentions,
 * images for free); the note is posted as a task comment server-side and the
 * FAIL verdict carries no enum.
 *
 * LUM-422 ③ deep link: a `?verdict=pass` query param (set by
 * `lumo verdict --pass`) focuses the PASS action.
 *
 * LUM-454 DONE gate: when a PASS can't reach Done because boundary crossings are
 * undispositioned (409), render a compact deduplicated notice built from the
 * loaded crossing data — not the raw multi-line server string.
 */
export function VerdictDecision({
  variant,
  taskIdentifier,
  data,
  onVerdictRecorded,
  mentionSources,
  latestRunSummary,
}: VerdictDecisionProps) {
  const intl = useIntl()
  const searchParams = useSearchParams()
  const deepLinkVerdict = searchParams?.get('verdict') ?? null
  const router = useRouter()
  const pathname = usePathname()
  const [panel, setPanel] = useState<'FAIL' | null>(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)
  // The specific server-provided reason to show on failure; null = use the
  // generic retry copy (LUM-453).
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // LUM-454: when the failure is the DONE gate tripping on undispositioned
  // boundary crossings, render a compact structured notice from the loaded
  // crossing data instead of the raw (repeated) server string.
  const [blockedByCrossings, setBlockedByCrossings] = useState(false)
  // LUM-586: undo verdict — open the one-step inline confirm.
  const [undoOpen, setUndoOpen] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [undoFailed, setUndoFailed] = useState(false)
  const [undoErrorMessage, setUndoErrorMessage] = useState<string | null>(null)
  const passButtonRef = useRef<HTMLButtonElement>(null)
  const editorClearRef = useRef<(() => void) | null>(null)

  const status = deriveVerdictStatus(data)
  const isReview = data.task.status === 'IN_REVIEW'

  // The DONE-blocked notice's "Review the crossings below" link. In the
  // floating bar (above the tabs) the crossings panel — which only renders
  // inside the Record tab — may not be mounted, so a plain #anchor would be a
  // dead link. When the anchor has no target, route to the Record tab carrying
  // the hash: TimelineTabs reconciles the tab from the URL and the panel
  // scrolls itself into view on mount. When the panel IS mounted (the header
  // variant, or the bar while on Record), leave the native hash jump alone.
  const openCrossingsPanel = (e: MouseEvent<HTMLAnchorElement>) => {
    if (typeof document === 'undefined') return
    if (document.getElementById(BOUNDARY_CROSSINGS_ANCHOR)) return
    e.preventDefault()
    router.push(boundaryCrossingsHref(pathname ?? ''), { scroll: false })
  }

  // Load this task's crossings so the DONE-blocked notice is built from data,
  // not parsed from the error string. Shares react-query cache with the
  // acceptance tab's panel (same key), so this adds no extra network call.
  const { crossings } = useBoundaryCrossings({
    identifier: taskIdentifier,
    enabled: isReview,
  })
  const undisposed = crossings.filter(c => c.disposition == null)
  // Deduplicate the blocking crossings by category, most-frequent first — the
  // "distinct categories with a count" summary that replaces the red wall.
  const blockedByCategory = (() => {
    const byCategory = new Map<string, number>()
    for (const c of undisposed) {
      byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + 1)
    }
    return [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([category, count]) => ({ category, count }))
  })()

  // Deep-link focus: carry the human to the one click that records the verdict.
  useEffect(() => {
    if (!isReview) return
    if (deepLinkVerdict === 'pass') {
      passButtonRef.current?.focus()
    }
  }, [deepLinkVerdict, isReview])

  // The floating variant is review-only chrome: nothing to show off IN_REVIEW.
  // Exception: if an undo affordance or withdrawal line is available, keep it
  // visible so the reviewer can undo a verdict on a DONE task (LUM-586).
  // The header variant always renders — it IS the always-on status banner.
  const hasUndoContent =
    data.undoableHumanVerdict != null || data.lastVerdictWithdrawal != null
  if (variant === 'floating' && !isReview && !hasUndoContent) return null

  const submit = async (verdict: HumanVerdict) => {
    setSubmitting(true)
    setFailed(false)
    setErrorMessage(null)
    setBlockedByCrossings(false)
    try {
      const sendNote = verdict !== 'PASS' && hasContent(note) ? note : undefined
      const result = await tasksClient.submitHumanVerdict<HumanVerdictResult>(
        taskIdentifier,
        {
          verdict,
          ...(sendNote ? { note: sendNote } : {}),
        }
      )
      onVerdictRecorded(result)
    } catch (err) {
      setFailed(true)
      // LUM-454: a 409 with undispositioned crossings loaded IS the boundary
      // DONE gate (a PASS only reaches the DONE transition when every criterion
      // is met, so it can't be a send-back gate). Render the compact notice
      // from `undisposed` rather than the raw multi-line string.
      const doneBlockedByCrossings =
        err instanceof ApiClientError &&
        err.status === 409 &&
        undisposed.length > 0
      setBlockedByCrossings(doneBlockedByCrossings)
      // Otherwise surface the server's real reason when it's an HTTP 4xx
      // carrying a message (403 human-only, 404, 409 send-back gate, …) — the
      // route returns error.message for every non-500 status. Network failures,
      // unknown errors, and 5xx keep the generic retry copy: those may be
      // transient, so "try again" stays the honest message (LUM-453).
      setErrorMessage(
        !doneBlockedByCrossings &&
          err instanceof ApiClientError &&
          err.status >= 400 &&
          err.status < 500
          ? err.message
          : null
      )
    } finally {
      setSubmitting(false)
    }
  }

  const openPanel = (next: 'FAIL') => {
    setPanel(prev => (prev === next ? null : next))
    setNote('')
    setFailed(false)
    setErrorMessage(null)
    setBlockedByCrossings(false)
  }

  // LUM-586: confirm undo — DELETE the verdict action, then bubble the result
  // to onVerdictRecorded so the parent can refresh.
  const confirmUndo = async () => {
    setUndoing(true)
    setUndoFailed(false)
    setUndoErrorMessage(null)
    try {
      const result =
        await tasksClient.undoHumanVerdict<HumanVerdictResult>(taskIdentifier)
      setUndoOpen(false)
      onVerdictRecorded(result)
    } catch (err) {
      setUndoFailed(true)
      setUndoErrorMessage(
        err instanceof ApiClientError && err.status >= 400 && err.status < 500
          ? err.message
          : null
      )
    } finally {
      setUndoing(false)
    }
  }

  const Icon = KIND_ICON[status.kind]
  const title =
    status.kind === 'sentBack'
      ? intl.formatMessage(
          { id: KIND_TITLE_ID[status.kind] },
          { count: status.failCount }
        )
      : intl.formatMessage({ id: KIND_TITLE_ID[status.kind] })
  const gate = intl.formatMessage({
    id: status.gateBlocked
      ? 'acceptance.banner.gateBlocked'
      : 'acceptance.banner.gateOpen',
  })

  // LUM-620: the hero action bar spells the consequence out ("Approve · mark
  // Done" / "Request changes") with a lead-in helper line; the compact floating
  // bar keeps the terse Pass / Fail labels. Same testids, same handlers — only
  // the labels/affordance differ, so every VerdictDecision test still targets
  // verdict-pass / verdict-fail unchanged.
  const actionButtons = (hero: boolean) => (
    <div className='flex flex-wrap items-center gap-2'>
      {hero ? (
        <span className='mr-auto text-caption text-muted-foreground'>
          {intl.formatMessage({
            id: 'acceptance.hero.helper',
            defaultMessage:
              'Your verdict marks the task Done or sends it back.',
          })}
        </span>
      ) : null}
      <ActionTooltip
        tip={intl.formatMessage({
          id: 'task.verdict.failTip',
          defaultMessage:
            'Reject and send the task back — it cannot be marked Done until re-verified.',
        })}
      >
        <Button
          size='sm'
          variant='outline'
          data-testid='verdict-fail'
          disabled={submitting}
          onClick={() => openPanel('FAIL')}
        >
          {hero
            ? intl.formatMessage({
                id: 'task.verdict.requestChanges',
                defaultMessage: 'Request changes',
              })
            : intl.formatMessage({ id: 'task.verdict.fail' })}
        </Button>
      </ActionTooltip>
      <ActionTooltip
        tip={intl.formatMessage({
          id: 'task.verdict.passTip',
          defaultMessage:
            'Accept the task as done — all criteria are met and it moves to completed.',
        })}
      >
        <Button
          ref={passButtonRef}
          size='sm'
          data-testid='verdict-pass'
          disabled={submitting}
          onClick={() => submit('PASS')}
          className={hero ? 'gap-1.5' : undefined}
        >
          {hero ? (
            <>
              <CheckCheck className='size-3.5' aria-hidden />
              {intl.formatMessage({
                id: 'task.verdict.approveHero',
                defaultMessage: 'Approve · mark Done',
              })}
            </>
          ) : (
            intl.formatMessage({ id: 'task.verdict.pass' })
          )}
        </Button>
      </ActionTooltip>
    </div>
  )

  const panelAndNotice = (
    <>
      {panel !== null && (
        <div className='mt-3 space-y-2 border-t border-border pt-3'>
          <label className='block text-caption font-medium text-muted-foreground'>
            {intl.formatMessage({ id: 'task.verdict.noteLabel' })}
          </label>
          <div
            data-testid='verdict-note'
            className='rounded-md border border-input bg-background'
          >
            <CommentEditor
              onCommit={html => setNote(html ?? '')}
              onSubmit={() => submit('FAIL')}
              clearRef={editorClearRef}
              placeholderId='task.verdict.notePlaceholder'
              {...(mentionSources ? { mentionSources } : {})}
            />
          </div>
          <div className='flex items-center gap-2'>
            <Button
              size='sm'
              variant='destructive'
              data-testid='verdict-confirm'
              disabled={submitting}
              onClick={() => submit('FAIL')}
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

      {failed && blockedByCrossings ? (
        <div
          data-testid='verdict-done-blocked'
          className='mt-3 rounded-md border border-warning-border bg-warning-subtle/40 px-3 py-2.5'
        >
          <p className='text-caption font-semibold text-foreground'>
            {intl.formatMessage(
              { id: 'task.verdict.blocked.headline' },
              { count: undisposed.length }
            )}
          </p>
          <div className='mt-1.5 flex flex-wrap gap-1.5'>
            {blockedByCategory.map(({ category, count }) => (
              <span
                key={category}
                data-testid={`verdict-blocked-cat-${category}`}
                className='inline-flex items-center gap-1 rounded-md bg-danger-subtle px-2 py-0.5 text-[11px] font-medium text-danger'
              >
                {count}× {boundaryCategoryLabel(category, intl)}
              </span>
            ))}
          </div>
          <p className='mt-2 text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'task.verdict.blocked.action' })}
          </p>
          <a
            data-testid='verdict-blocked-link'
            href={`#${BOUNDARY_CROSSINGS_ANCHOR}`}
            onClick={openCrossingsPanel}
            className='mt-1.5 inline-block text-caption font-medium text-primary hover:underline'
          >
            {intl.formatMessage({ id: 'task.verdict.blocked.viewCrossings' })}
          </a>
        </div>
      ) : failed ? (
        <p
          data-testid='verdict-error'
          className='mt-2 text-caption text-danger'
        >
          {errorMessage || intl.formatMessage({ id: 'task.verdict.error' })}
        </p>
      ) : null}
    </>
  )

  // LUM-586: "Undo verdict" — a quiet secondary affordance rendered when a
  // standing human verdict is present (data.undoableHumanVerdict != null).
  // Gate is on the field, NOT on isReview — a just-accepted task is DONE, not
  // IN_REVIEW, and must still show Undo.
  const undoAffordance = data.undoableHumanVerdict ? (
    <div className='mt-3 border-t border-border pt-3'>
      {!undoOpen ? (
        <button
          type='button'
          data-testid='verdict-undo'
          onClick={() => setUndoOpen(true)}
          className='inline-flex items-center gap-1.5 text-caption text-muted-foreground hover:text-foreground hover:underline'
        >
          <Undo2 className='size-3.5' aria-hidden />
          {intl.formatMessage({ id: 'task.verdict.undoPrompt' })}
        </button>
      ) : (
        <div className='rounded-md border border-border bg-muted/30 px-3 py-2.5'>
          <div className='mb-2 flex items-center gap-1.5 text-caption font-medium text-foreground'>
            <UserCheck className='size-3.5' aria-hidden />
            {intl.formatMessage({ id: 'task.verdict.undo' })}
          </div>
          <p className='mb-2 text-caption text-muted-foreground'>
            {intl.formatMessage(
              { id: 'task.verdict.undoConfirmBody' },
              { verdict: data.undoableHumanVerdict.verdict }
            )}
          </p>
          <div className='flex items-center gap-2'>
            <Button
              size='sm'
              variant='outline'
              data-testid='verdict-undo-confirm'
              disabled={undoing}
              onClick={() => void confirmUndo()}
            >
              {intl.formatMessage({ id: 'task.verdict.undoConfirm' })}
            </Button>
            <Button
              size='sm'
              variant='ghost'
              disabled={undoing}
              onClick={() => setUndoOpen(false)}
            >
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
          </div>
          {undoFailed && (
            <p
              data-testid='verdict-undo-error'
              className='mt-2 text-caption text-danger'
            >
              {undoErrorMessage ||
                intl.formatMessage({ id: 'task.verdict.error' })}
            </p>
          )}
        </div>
      )}
    </div>
  ) : null

  // LUM-586: correction line — rendered when a verdict was previously withdrawn.
  const withdrawalLine = data.lastVerdictWithdrawal ? (
    <div
      data-testid='verdict-withdrawn'
      className='mt-2 flex items-center gap-1.5 text-caption text-muted-foreground'
    >
      <Undo2 className='size-3.5 shrink-0' aria-hidden />
      {intl.formatMessage(
        { id: 'task.verdict.withdrawnBy' },
        {
          by:
            data.lastVerdictWithdrawal.actorName ??
            intl.formatMessage({ id: 'boundary.panel.someone' }),
          verdict: data.lastVerdictWithdrawal.verdict,
        }
      )}
    </div>
  ) : null

  // metCount + optional human-override + gate line (shared by both variants).
  const metLine = (
    <>
      {intl.formatMessage(
        { id: 'acceptance.banner.metCount' },
        { passed: status.met, total: status.total }
      )}
      {status.hasHumanOverride ? (
        <>
          {' · '}
          {intl.formatMessage({ id: 'acceptance.tab.humanOverride' })}
          <InfoTooltip
            className='ml-0.5 align-middle'
            label={intl.formatMessage({
              id: 'acceptance.tab.humanOverrideTip',
              defaultMessage:
                'Passed because a person signed off — no machine check confirmed this criterion.',
            })}
          />
        </>
      ) : null}
    </>
  )

  const roundBadge = (
    <span className='shrink-0 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground'>
      {intl.formatMessage(
        { id: 'acceptance.banner.roundBadge' },
        { round: status.round, max: status.maxRounds }
      )}
    </span>
  )

  // LUM-620 · Decision Hero — the redesigned verdict surface shared by both
  // variants: a progress ring (criteria met) leads a state label + headline +
  // met/gate subline; the action bar (Request changes · Approve · mark Done)
  // rides under a divider during IN_REVIEW. Accent is keyed to the hero state
  // (pending magenta / accepted green / changes amber), derived from the status
  // kind so it stays in lockstep with the already-computed banner tone.
  const heroState = heroStateOf(status.kind)
  const stateLabelId =
    heroState === 'accepted'
      ? 'acceptance.hero.stateAccepted'
      : heroState === 'changes'
        ? 'acceptance.hero.stateChanges'
        : 'acceptance.hero.stateReview'
  const stateLabelDefault =
    heroState === 'accepted'
      ? 'ACCEPTED'
      : heroState === 'changes'
        ? 'CHANGES REQUESTED'
        : 'IN REVIEW'

  const heroBody = (
    <>
      <div className='flex items-center gap-4 px-5 py-4'>
        <ProgressRing
          met={status.met}
          total={status.total}
          className={HERO_RING[heroState]}
          metLabel={intl.formatMessage({
            id: 'acceptance.hero.metLabel',
            defaultMessage: 'met',
          })}
        />
        {/* verdict-status carries the title text the existing tests assert on
            (KIND_TITLE_ID[kind]); keep the headline inside it. */}
        <div data-testid='verdict-status' className='min-w-0 flex-1'>
          <div className='mb-1 flex items-center gap-2'>
            <span
              className={`inline-block size-2 rounded-full ${HERO_RING[heroState].replace('text-', 'bg-')}`}
              aria-hidden
            />
            <span
              className={`text-[11px] font-semibold uppercase tracking-wide ${HERO_LABEL[heroState]}`}
            >
              {intl.formatMessage({
                id: stateLabelId,
                defaultMessage: stateLabelDefault,
              })}
            </span>
          </div>
          <div className='text-[19px] font-semibold leading-tight tracking-tight text-foreground'>
            {title}
          </div>
          <div className='mt-1 text-caption text-muted-foreground'>
            {metLine}
            {' · '}
            {gate}
          </div>
        </div>
        {roundBadge}
      </div>
      {/* LUM-481: latest run's summary — context for the reviewer (header only;
          the floating bar never renders it, even if a summary is passed). */}
      {variant === 'header' && latestRunSummary ? (
        <div
          data-testid='verdict-run-summary'
          className='border-t border-border/60 px-5 py-2.5'
        >
          <div className='flex items-center gap-1 text-caption font-medium text-status-in-review'>
            <Sparkles className='size-3' aria-hidden />
            {intl.formatMessage({
              id: 'acceptance.runSummary',
              defaultMessage: '本次运行',
            })}
          </div>
          <p className='mt-1 text-caption text-foreground'>
            {latestRunSummary}
          </p>
        </div>
      ) : null}
      {isReview && (
        <div className='border-t border-border/60 bg-background/40 px-5 py-3'>
          {actionButtons(true)}
          {panelAndNotice}
        </div>
      )}
      {(undoAffordance || withdrawalLine) && (
        <div className='px-5 pb-4'>
          {undoAffordance}
          {withdrawalLine}
        </div>
      )}
    </>
  )

  if (variant === 'header') {
    // Loud hero card while adjudicating (IN_REVIEW), or right after a verdict
    // lands while it can still be undone (the mockup's Accepted / Changes
    // confirmation with an Undo). A long-settled task keeps the quiet passive
    // banner (LUM-489) — no heavy card for a decision made long ago.
    const showHeroCard =
      isReview || (heroState !== 'pending' && data.undoableHumanVerdict != null)
    if (showHeroCard) {
      return (
        <div
          data-testid='verdict-status-banner'
          data-hero-state={heroState}
          className={`overflow-hidden rounded-lg border ${HERO_CARD[heroState]}`}
        >
          {heroBody}
        </div>
      )
    }
    // Passive banner — quiet inline row for a settled/pre-review task.
    return (
      <div data-testid='verdict-status-banner' className='py-1'>
        <StatusBannerRow
          layout='header'
          Icon={Icon}
          tone={status.tone}
          title={title}
          metLine={metLine}
          gate={gate}
          roundBadge={roundBadge}
        />
        {latestRunSummary ? (
          <div
            data-testid='verdict-run-summary'
            className='mt-2.5 border-t border-border pt-2.5'
          >
            <div className='flex items-center gap-1 text-caption font-medium text-status-in-review'>
              <Sparkles className='size-3' aria-hidden />
              {intl.formatMessage({
                id: 'acceptance.runSummary',
                defaultMessage: '本次运行',
              })}
            </div>
            <p className='mt-1 text-caption text-foreground'>
              {latestRunSummary}
            </p>
          </div>
        ) : null}
        {undoAffordance}
        {withdrawalLine}
      </div>
    )
  }

  // floating — the same Decision Hero, keyed by the task-verdict-bar testid and
  // a bottom margin; only reached when there is something to show (IN_REVIEW or
  // an undo/withdrawal affordance on a just-decided task; the earlier guard
  // returns null otherwise).
  return (
    <div
      data-testid='task-verdict-bar'
      data-hero-state={heroState}
      className={`mb-4 overflow-hidden rounded-lg border ${HERO_CARD[heroState]}`}
    >
      {heroBody}
    </div>
  )
}
