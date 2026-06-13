'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useIntl } from 'react-intl'
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Unlock,
  FlagOff,
  AlertTriangle,
  CircleCheck,
  Lightbulb,
  Plus,
  UserCheck,
  ExternalLink,
  Info,
  ChevronRight,
  ChevronDown,
  FileWarning,
  Bot,
  Repeat,
} from 'lucide-react'
import { tasksClient } from '@/lib/api-client'
import {
  useBoundaryCrossings,
  type BoundaryCrossingView,
  type CrossingAttributionView,
  type EditChangeView,
} from '../../hooks/useBoundaryCrossings'
import type { WorkspaceMemberInfo } from '../../types'
import {
  boundaryCategoryLabel,
  boundaryDispositionLabel,
  boundaryDispositionOrOpenLabel,
  boundaryReversibilityLabel,
  boundarySeverityLabel,
} from './boundary-format'

interface BoundaryCrossingsPanelProps {
  taskIdentifier: string
  enabled: boolean
  /** Workspace URL slug, for linking a remediation task to its detail page. */
  workspaceUrl?: string
  members?: WorkspaceMemberInfo[]
  agentActors?: { actorId: string; name: string }[]
  /** Refresh the acceptance banner after a disposition/remediation changes state. */
  onChanged?: () => void
}

/**
 * AcceptanceTab panel listing ALL of a task's forbidden-action boundary-
 * crossings — open AND dispositioned (LUM-435, criterion 6). Renders nothing
 * when the task has none. Open crossings block Done and offer the human-only
 * disposition (false positive / confirm). Dispositioned crossings stay on
 * record with reviewer + time; a confirmed one nudges (not forces) a remediation
 * task and surfaces that task's live status. Reversibility is legible per row.
 */
export function BoundaryCrossingsPanel({
  taskIdentifier,
  enabled,
  workspaceUrl = '',
  members = [],
  agentActors = [],
  onChanged,
}: BoundaryCrossingsPanelProps) {
  const intl = useIntl()
  const { crossings, refresh } = useBoundaryCrossings({
    identifier: taskIdentifier,
    enabled,
  })
  const [pending, setPending] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  const openCount = crossings.filter(c => c.disposition == null).length

  const [expanded, setExpanded] = useState(() => openCount > 0)
  const prevOpen = useRef(openCount)
  useEffect(() => {
    if (openCount > prevOpen.current) setExpanded(true) // re-open if a new undisposed crossing arrives
    prevOpen.current = openCount
  }, [openCount])

  if (crossings.length === 0) return null

  const categoryCounts = (() => {
    const m = new Map<string, number>()
    for (const c of crossings) m.set(c.category, (m.get(c.category) ?? 0) + 1)
    return [...m.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    )
  })()

  const afterChange = () => {
    void refresh()
    onChanged?.()
  }

  const errorToast = () =>
    toast.error(
      intl.formatMessage({
        id: 'boundary.toast.error',
        defaultMessage: 'Action failed — please try again',
      })
    )

  const disposition = (
    crossingId: string,
    verdict: 'FALSE_POSITIVE' | 'CONFIRMED' | 'OPEN'
  ) => {
    setPending(crossingId)
    const note = notes[crossingId]?.trim()
    void tasksClient
      .dispositionBoundaryCrossing(
        taskIdentifier,
        crossingId,
        verdict,
        note || undefined
      )
      .then(() => {
        toast.success(
          verdict === 'OPEN'
            ? intl.formatMessage({
                id: 'boundary.toast.reopened',
                defaultMessage: 'Crossing reopened — Done is blocked again',
              })
            : intl.formatMessage({
                id: 'boundary.toast.dispositioned',
                defaultMessage: 'Crossing dispositioned — Done is unblocked',
              })
        )
        afterChange()
      })
      .catch(errorToast)
      .finally(() => setPending(null))
  }

  const spawnRemediation = (crossingId: string) => {
    setPending(crossingId)
    void tasksClient
      .spawnBoundaryRemediation<{ remediationTaskIdentifier: string }>(
        taskIdentifier,
        crossingId
      )
      .then(res => {
        toast.success(
          intl.formatMessage(
            {
              id: 'boundary.toast.remediationSpawned',
              defaultMessage: 'Remediation task {identifier} created',
            },
            { identifier: res.remediationTaskIdentifier }
          )
        )
        afterChange()
      })
      .catch(errorToast)
      .finally(() => setPending(null))
  }

  const reviewerName = (actorId: string | null): string | null => {
    if (!actorId) return null
    return (
      members.find(m => m.actorId === actorId)?.name ??
      agentActors.find(a => a.actorId === actorId)?.name ??
      null
    )
  }

  // The human whose agent committed a crossing (LUM-469) — resolved from the
  // attribution's workspaceMemberId, the owning member, NOT the dispositioner.
  const ownerName = (workspaceMemberId: string | null): string | null => {
    if (!workspaceMemberId) return null
    return members.find(m => m.id === workspaceMemberId)?.name ?? null
  }

  return (
    // id anchors the verdict bar's DONE-blocked notice link here (LUM-454).
    <div
      id='boundary-crossings'
      className='rounded-lg border border-warning-border bg-warning-subtle/40 p-3.5'
    >
      {/* Always-visible summary/toggle header */}
      <button
        type='button'
        data-testid='boundary-summary-toggle'
        aria-expanded={expanded}
        onClick={() => setExpanded(e => !e)}
        className='mb-2 flex w-full items-center gap-2 text-left'
      >
        {openCount === 0 ? (
          <ShieldCheck className='size-4 shrink-0 text-success' aria-hidden />
        ) : (
          <ShieldAlert className='size-4 shrink-0 text-warning' aria-hidden />
        )}
        <span className='text-sm font-medium text-foreground'>
          {intl.formatMessage({
            id: 'boundary.panel.title',
            defaultMessage: 'Boundary crossings',
          })}
        </span>
        {openCount > 0 && (
          <span className='rounded-md bg-danger-subtle px-2 py-0.5 text-[11px] font-medium text-danger'>
            {intl.formatMessage(
              {
                id: 'boundary.panel.openCount',
                defaultMessage: '{count, plural, one {# open} other {# open}}',
              },
              { count: openCount }
            )}
          </span>
        )}
        {categoryCounts.map(([cat, n]) => (
          <span
            key={cat}
            className='rounded-md bg-warning-subtle px-1.5 py-0.5 text-[11px] font-medium text-warning'
          >
            {boundaryCategoryLabel(cat, intl)} ×{n}
          </span>
        ))}
        {openCount === 0 && (
          <span className='text-[11px] text-muted-foreground/80'>
            {intl.formatMessage(
              {
                id: 'boundary.panel.allCleared',
                defaultMessage:
                  '{count, plural, one {# dispositioned} other {# dispositioned}} · 0 open',
              },
              { count: crossings.length }
            )}
          </span>
        )}
        <span className='ml-auto text-[11px] text-muted-foreground/80'>
          {intl.formatMessage({
            id: 'boundary.panel.confirmedStay',
            defaultMessage: 'Confirmed crossings stay on record.',
          })}
        </span>
        <ChevronRight
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
          aria-hidden
        />
      </button>

      {expanded && (
        <>
          {openCount > 0 && (
            <p className='mb-3 flex items-start gap-1.5 text-xs text-muted-foreground'>
              <Lock className='mt-0.5 size-3.5 shrink-0' aria-hidden />
              <span>
                {intl.formatMessage({
                  id: 'boundary.panel.blockedNote',
                  defaultMessage:
                    "This task can't move to Done until each open crossing is dispositioned by a human — as a false positive, or confirmed.",
                })}
              </span>
            </p>
          )}

          <div className='space-y-2'>
            {crossings.map(c => (
              <CrossingRow
                key={c.id}
                crossing={c}
                intl={intl}
                workspaceUrl={workspaceUrl}
                pending={pending === c.id}
                note={notes[c.id] ?? ''}
                reviewerName={reviewerName(c.dispositionedById)}
                ownerName={ownerName(c.attribution?.workspaceMemberId ?? null)}
                changeReviewerName={reviewerName(
                  c.lastDispositionChange?.actorId ?? null
                )}
                onNote={v => setNotes(prev => ({ ...prev, [c.id]: v }))}
                onDisposition={verdict => disposition(c.id, verdict)}
                onSpawnRemediation={() => spawnRemediation(c.id)}
              />
            ))}
          </div>

          <p className='mt-3 flex items-center gap-1 text-[11px] text-muted-foreground/80'>
            <UserCheck className='size-3.5 shrink-0' aria-hidden />
            {intl.formatMessage({
              id: 'boundary.panel.humanOnly',
              defaultMessage:
                'Only a signed-in human can disposition a crossing — the agent/CLI path is closed by design.',
            })}
          </p>

          <p className='mt-1.5 flex items-start gap-1 text-[11px] text-muted-foreground/80'>
            <Info className='mt-0.5 size-3.5 shrink-0' aria-hidden />
            <span>
              {intl.formatMessage({
                id: 'boundary.panel.defenseInDepth',
                defaultMessage:
                  'Defense-in-depth, not a hard boundary: this runs after the action and can be evaded (e.g. obfuscated commands). A clean panel is not proof nothing happened — treat it as one signal, not a guarantee.',
              })}
            </span>
          </p>
        </>
      )}
    </div>
  )
}

function CrossingRow({
  crossing: c,
  intl,
  workspaceUrl,
  pending,
  note,
  reviewerName,
  ownerName,
  changeReviewerName,
  onNote,
  onDisposition,
  onSpawnRemediation,
}: {
  crossing: BoundaryCrossingView
  intl: ReturnType<typeof useIntl>
  workspaceUrl: string
  pending: boolean
  note: string
  reviewerName: string | null
  ownerName: string | null
  changeReviewerName: string | null
  onNote: (v: string) => void
  onDisposition: (verdict: 'FALSE_POSITIVE' | 'CONFIRMED' | 'OPEN') => void
  onSpawnRemediation: () => void
}) {
  const [cmdOpen, setCmdOpen] = useState(false)
  const open = c.disposition == null
  // Already-dispositioned crossings collapse by default — handled, kept for the
  // record but out of the way; open ones start expanded since they still need a
  // human decision and block Done.
  const [collapsed, setCollapsed] = useState(!open)
  const rt = c.remediationTask
  // The other verdict a one-click "change" flips to.
  const otherVerdict =
    c.disposition === 'CONFIRMED' ? 'FALSE_POSITIVE' : 'CONFIRMED'

  return (
    <div className='rounded-md border border-border bg-background px-3 py-2.5'>
      <button
        type='button'
        onClick={() => setCollapsed(v => !v)}
        aria-expanded={!collapsed}
        data-testid={`crossing-toggle-${c.id}`}
        className='flex w-full flex-wrap items-center gap-2 text-left'
      >
        <ChevronRight
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${collapsed ? '' : 'rotate-90'}`}
          aria-hidden
        />
        <span className='text-[13px] font-medium text-foreground'>
          {boundaryCategoryLabel(c.category, intl)}
        </span>
        <Badge
          tone={
            c.severity === 'HIGH'
              ? 'danger'
              : c.severity === 'LOW'
                ? 'muted'
                : 'warning'
          }
        >
          {intl.formatMessage(
            {
              id: 'boundary.panel.severityBadge',
              defaultMessage: '{severity} severity',
            },
            { severity: boundarySeverityLabel(c.severity, intl) }
          )}
        </Badge>
        {c.disposition === 'CONFIRMED' && (
          <Badge tone='warning'>
            {boundaryDispositionLabel('CONFIRMED', intl)}
          </Badge>
        )}
        {c.disposition === 'FALSE_POSITIVE' && (
          <Badge tone='muted'>
            {boundaryDispositionLabel('FALSE_POSITIVE', intl)}
          </Badge>
        )}
        <Badge tone={c.reversible ? 'muted' : 'danger'}>
          {c.reversible ? (
            <Unlock className='size-3' aria-hidden />
          ) : (
            <Lock className='size-3' aria-hidden />
          )}
          {boundaryReversibilityLabel(c.reversible, intl)}
        </Badge>
        {/* Recurrence (LUM-477): the same action/file tripped the detector more
        than once while open. Surfaced so the reviewer dispositions it ONCE yet
        still sees it repeated; titled with the last-seen time. */}
        {(c.occurrenceCount ?? 1) > 1 && (
          <span
            data-testid={`crossing-recurrence-${c.id}`}
            title={
              c.lastSeenAt
                ? intl.formatMessage(
                    {
                      id: 'boundary.panel.lastSeen',
                      defaultMessage: 'Last seen {at}',
                    },
                    { at: new Date(c.lastSeenAt).toLocaleString(intl.locale) }
                  )
                : undefined
            }
            className='inline-flex items-center gap-1 rounded-md bg-warning-subtle px-2 py-0.5 text-[11px] font-medium text-warning'
          >
            <Repeat className='size-3' aria-hidden />
            {intl.formatMessage(
              {
                id: 'boundary.panel.recurrence',
                defaultMessage: 'seen ×{count}',
              },
              { count: c.occurrenceCount }
            )}
          </span>
        )}
        <span className='ml-auto text-[11px] text-muted-foreground/80'>
          {open
            ? new Date(c.detectedAt).toLocaleString(intl.locale)
            : intl.formatMessage(
                {
                  id: 'boundary.panel.dispositionedBy',
                  defaultMessage: '{by}{at}',
                },
                {
                  by: reviewerName
                    ? intl.formatMessage(
                        {
                          id: 'boundary.panel.byReviewer',
                          defaultMessage: 'by {name} · ',
                        },
                        { name: reviewerName }
                      )
                    : '',
                  at: c.dispositionedAt
                    ? new Date(c.dispositionedAt).toLocaleString(intl.locale)
                    : '',
                }
              )}
        </span>
      </button>

      {!collapsed && (
        <>
          <code
            data-testid={`crossing-cmd-${c.id}`}
            onClick={() => setCmdOpen(o => !o)}
            className={`mt-1.5 block cursor-pointer rounded-md bg-muted/60 px-2 py-1 font-mono text-[11px] text-foreground ${cmdOpen ? 'whitespace-pre-wrap break-all' : 'truncate whitespace-nowrap'}`}
            title={cmdOpen ? undefined : c.detail}
          >
            {c.detail}
          </code>

          <AttributionLine
            attribution={c.attribution ?? UNKNOWN_ATTRIBUTION}
            ownerName={ownerName}
            intl={intl}
          />

          {c.editChange && (
            <EditChangeBlock change={c.editChange} intl={intl} />
          )}

          {c.category === 'TEST_TAMPERING' && open && (
            <p className='mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground'>
              <ShieldAlert
                className='mt-0.5 size-3.5 shrink-0 text-warning'
                aria-hidden
              />
              <span>
                {intl.formatMessage({
                  id: 'boundary.panel.testTamperingHint',
                  defaultMessage:
                    'Reward-hacking check: confirm the underlying code was fixed — not that the test was weakened to force a pass. Legit test fix? Mark it a false positive.',
                })}
              </span>
            </p>
          )}

          {c.dispositionNote && (
            <p className='mt-1.5 text-[11px] text-muted-foreground'>
              {intl.formatMessage(
                { id: 'boundary.panel.note', defaultMessage: 'Note: {note}' },
                { note: c.dispositionNote }
              )}
            </p>
          )}

          {/* A re-disposition reads as a correction, not a silent swap (LUM-450):
          who changed it, and the from -> to transition. */}
          {c.lastDispositionChange && (
            <p
              data-testid={`boundary-corrected-${c.id}`}
              className='mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground'
            >
              <UserCheck className='mt-0.5 size-3.5 shrink-0' aria-hidden />
              <span>
                {intl.formatMessage(
                  {
                    id: 'boundary.panel.corrected',
                    defaultMessage: 'Corrected by {by}: {from} → {to}',
                  },
                  {
                    by:
                      changeReviewerName ??
                      intl.formatMessage({
                        id: 'boundary.panel.someone',
                        defaultMessage: 'a reviewer',
                      }),
                    from: boundaryDispositionOrOpenLabel(
                      c.lastDispositionChange.from,
                      intl
                    ),
                    to: boundaryDispositionOrOpenLabel(
                      c.lastDispositionChange.to,
                      intl
                    ),
                  }
                )}
              </span>
            </p>
          )}

          {open && (
            <div className='mt-2.5 space-y-2'>
              <input
                type='text'
                value={note}
                disabled={pending}
                onChange={e => onNote(e.target.value)}
                placeholder={intl.formatMessage({
                  id: 'boundary.panel.notePlaceholder',
                  defaultMessage: 'Disposition note (optional)',
                })}
                className='w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring'
              />
              <div className='flex items-center gap-2'>
                <button
                  type='button'
                  data-testid={`boundary-false-positive-${c.id}`}
                  disabled={pending}
                  onClick={() => onDisposition('FALSE_POSITIVE')}
                  className='inline-flex items-center gap-1 rounded-sm border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50'
                >
                  <FlagOff className='size-3.5' aria-hidden />
                  {boundaryDispositionLabel('FALSE_POSITIVE', intl)}
                </button>
                <button
                  type='button'
                  data-testid={`boundary-confirm-${c.id}`}
                  disabled={pending}
                  onClick={() => onDisposition('CONFIRMED')}
                  className='inline-flex items-center gap-1 rounded-sm border border-danger-border bg-background px-2 py-1 text-[11px] font-medium text-danger hover:bg-danger-subtle disabled:opacity-50'
                >
                  <AlertTriangle className='size-3.5' aria-hidden />
                  {intl.formatMessage({
                    id: 'boundary.panel.confirmCrossing',
                    defaultMessage: 'Confirm crossing',
                  })}
                </button>
              </div>
            </div>
          )}

          {/* Re-disposition (LUM-450): a human can correct an already-dispositioned
          crossing — flip it to the other verdict, or reopen it (reverting to
          undispositioned, which re-blocks Done). Same human-only write path. */}
          {!open && (
            <div className='mt-2.5 space-y-2'>
              <input
                type='text'
                value={note}
                disabled={pending}
                onChange={e => onNote(e.target.value)}
                placeholder={intl.formatMessage({
                  id: 'boundary.panel.redispositionNotePlaceholder',
                  defaultMessage: 'Reason for the change (optional)',
                })}
                className='w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring'
              />
              <div className='flex flex-wrap items-center gap-2'>
                <button
                  type='button'
                  data-testid={`boundary-change-${c.id}`}
                  disabled={pending}
                  onClick={() => onDisposition(otherVerdict)}
                  className='inline-flex items-center gap-1 rounded-sm border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50'
                >
                  <FlagOff className='size-3.5' aria-hidden />
                  {intl.formatMessage(
                    {
                      id: 'boundary.panel.changeTo',
                      defaultMessage: 'Change to {verdict}',
                    },
                    { verdict: boundaryDispositionLabel(otherVerdict, intl) }
                  )}
                </button>
                <button
                  type='button'
                  data-testid={`boundary-reopen-${c.id}`}
                  disabled={pending}
                  onClick={() => onDisposition('OPEN')}
                  className='inline-flex items-center gap-1 rounded-sm border border-warning-border bg-background px-2 py-1 text-[11px] font-medium text-warning hover:bg-warning-subtle disabled:opacity-50'
                >
                  <Unlock className='size-3.5' aria-hidden />
                  {intl.formatMessage({
                    id: 'boundary.panel.reopen',
                    defaultMessage: 'Reopen (re-block Done)',
                  })}
                </button>
              </div>
            </div>
          )}

          {rt && (
            <Link
              href={
                workspaceUrl
                  ? `/workspace/${workspaceUrl}/my-tasks/${rt.identifier}`
                  : '#'
              }
              className='mt-2 flex items-center gap-3 rounded-md border border-success-border bg-success-subtle/50 px-3 py-2.5 transition-colors hover:bg-success-subtle'
            >
              <CircleCheck
                className='size-5 shrink-0 text-success'
                aria-hidden
              />
              <div className='min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='text-xs font-medium text-success'>
                    {rt.remediated
                      ? intl.formatMessage({
                          id: 'boundary.panel.remediatedBy',
                          defaultMessage: 'Remediated by',
                        })
                      : intl.formatMessage({
                          id: 'boundary.panel.remediationLinked',
                          defaultMessage: 'Remediation:',
                        })}
                  </span>
                  <span className='text-[13px] font-medium text-foreground'>
                    {rt.identifier}
                  </span>
                  <span className='rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground'>
                    {rt.status}
                  </span>
                </div>
                <div className='truncate text-xs text-muted-foreground'>
                  {rt.title}
                </div>
              </div>
              <ExternalLink
                className='size-4 shrink-0 text-success'
                aria-hidden
              />
            </Link>
          )}

          {c.disposition === 'CONFIRMED' && !rt && (
            <div className='mt-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5'>
              <Lightbulb className='size-4 shrink-0 text-warning' aria-hidden />
              <span className='text-[11px] text-muted-foreground'>
                {intl.formatMessage({
                  id: 'boundary.panel.remediationNudge',
                  defaultMessage:
                    'Confirmed and unremediated — consider opening a fix.',
                })}
              </span>
              <button
                type='button'
                data-testid={`boundary-spawn-remediation-${c.id}`}
                disabled={pending}
                onClick={onSpawnRemediation}
                className='ml-auto inline-flex items-center gap-1 rounded-sm border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50'
              >
                <Plus className='size-3.5' aria-hidden />
                {intl.formatMessage({
                  id: 'boundary.panel.spawnRemediation',
                  defaultMessage: 'Spawn remediation task',
                })}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Fallback when a crossing view predates attribution (legacy / cached client
 *  response) — every dimension unknown so the row still renders (LUM-469). */
const UNKNOWN_ATTRIBUTION: CrossingAttributionView = {
  workspaceMemberId: null,
  sessionId: null,
  agent: null,
  worktreeBranch: null,
  model: null,
}

/**
 * Read-only attribution line (LUM-469): which model and which agent/session
 * committed this crossing, and whose agent it was. Lets a reviewer audit
 * who/what crossed the boundary without leaving the acceptance bar. Each
 * dimension that couldn't be resolved renders a localized "unknown" — never a
 * fabricated value. Owner is shown only when its display name resolves.
 */
function AttributionLine({
  attribution: a,
  ownerName,
  intl,
}: {
  attribution: CrossingAttributionView
  ownerName: string | null
  intl: ReturnType<typeof useIntl>
}) {
  const unknown = intl.formatMessage({
    id: 'boundary.panel.attribution.unknown',
    defaultMessage: 'unknown',
  })
  const agentText = a.agent
    ? a.worktreeBranch
      ? `${a.agent} · ${a.worktreeBranch}`
      : a.agent
    : unknown
  // A Claude Code session UUID is long — a short prefix is enough to correlate.
  const sessionText = a.sessionId ? a.sessionId.slice(0, 8) : unknown

  return (
    <p className='mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground'>
      <Bot className='size-3 shrink-0' aria-hidden />
      <span>
        {intl.formatMessage(
          {
            id: 'boundary.panel.attribution.model',
            defaultMessage: 'model: {model}',
          },
          { model: a.model ?? unknown }
        )}
      </span>
      <span aria-hidden>·</span>
      <span>
        {intl.formatMessage(
          {
            id: 'boundary.panel.attribution.agent',
            defaultMessage: 'agent: {agent}',
          },
          { agent: agentText }
        )}
      </span>
      <span aria-hidden>·</span>
      <span className='font-mono'>
        {intl.formatMessage(
          {
            id: 'boundary.panel.attribution.session',
            defaultMessage: 'session: {session}',
          },
          { session: sessionText }
        )}
      </span>
      {ownerName && (
        <>
          <span aria-hidden>·</span>
          <span>
            {intl.formatMessage(
              {
                id: 'boundary.panel.attribution.owner',
                defaultMessage: 'owner: {owner}',
              },
              { owner: ownerName }
            )}
          </span>
        </>
      )}
    </p>
  )
}

/**
 * Inline before→after of the edit that tripped a display-safe crossing (LUM-452)
 * — a reviewer reads the actual change and judges a legit test fix vs a weakened
 * test without leaving the acceptance bar. Content is already sanitized +
 * length-capped server-side; when it's unavailable we show a clear pointer (+ the
 * task's PR link when one exists) instead of a blank.
 */
function EditChangeBlock({
  change,
  intl,
}: {
  change: EditChangeView
  intl: ReturnType<typeof useIntl>
}) {
  const [expanded, setExpanded] = useState(false)
  const turnIntent = change.agentTurnContext ? (
    <TurnIntent text={change.agentTurnContext} intl={intl} />
  ) : null

  if (change.unavailable) {
    return (
      <div className='mt-1.5 space-y-1'>
        {turnIntent}
        <p className='flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground'>
          <FileWarning className='size-3.5 shrink-0' aria-hidden />
          <span>
            {intl.formatMessage({
              id: 'boundary.editChange.unavailable',
              defaultMessage: "The edit content isn't available to show here.",
            })}
          </span>
          <PrFallback href={change.prFileUrl ?? change.prUrl} intl={intl} />
        </p>
      </div>
    )
  }

  return (
    <div className='mt-1.5'>
      {turnIntent}
      <button
        type='button'
        onClick={() => setExpanded(v => !v)}
        className='inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground'
      >
        {expanded ? (
          <ChevronDown className='size-3.5' aria-hidden />
        ) : (
          <ChevronRight className='size-3.5' aria-hidden />
        )}
        {expanded
          ? intl.formatMessage({
              id: 'boundary.editChange.hide',
              defaultMessage: 'Hide edit',
            })
          : intl.formatMessage({
              id: 'boundary.editChange.show',
              defaultMessage: 'Show what the edit changed',
            })}
      </button>

      {expanded && (
        <div className='mt-1.5 space-y-1.5'>
          {change.kind === 'edit' && change.oldText != null && (
            <Snippet
              label={intl.formatMessage({
                id: 'boundary.editChange.removed',
                defaultMessage: 'Removed',
              })}
              tone='danger'
              text={change.oldText}
            />
          )}
          {change.newText != null && (
            <Snippet
              label={intl.formatMessage(
                change.kind === 'write'
                  ? {
                      id: 'boundary.editChange.written',
                      defaultMessage: 'Written content',
                    }
                  : {
                      id: 'boundary.editChange.added',
                      defaultMessage: 'Added',
                    }
              )}
              tone='success'
              text={change.newText}
            />
          )}
          {change.truncated && (
            <p className='flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground/80'>
              <span>
                {intl.formatMessage({
                  id: 'boundary.editChange.truncated',
                  defaultMessage: 'Truncated for display.',
                })}
              </span>
              <PrFallback href={change.prFileUrl ?? change.prUrl} intl={intl} />
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The agent's stated intent for the TURN this edit belongs to (LUM-455) — the
 * turn's LLM summary. Labeled "this turn" on purpose: Claude Code's hooks carry
 * no per-edit reason, so this is a turn-level proxy a reviewer cross-checks
 * against the actual diff, not a guaranteed justification for this one edit.
 */
function TurnIntent({
  text,
  intl,
}: {
  text: string
  intl: ReturnType<typeof useIntl>
}) {
  return (
    <p className='flex items-start gap-1.5 text-[11px] text-muted-foreground'>
      <Info className='mt-0.5 size-3.5 shrink-0' aria-hidden />
      <span>
        <span className='font-medium'>
          {intl.formatMessage({
            id: 'boundary.editChange.turnIntent',
            defaultMessage: "Agent's intent this turn:",
          })}
        </span>{' '}
        {text}
      </span>
    </p>
  )
}

/**
 * The fallback "go look at the full change" affordance (LUM-455). When the task
 * has a synced PR it is a real, clickable link straight to the changed file's
 * diff (falling back to the PR's Files tab); when it has none it is an explicit
 * "No linked PR" note — never a dead "open the PR" instruction with no link
 * behind it (criterion 3).
 */
function PrFallback({
  href,
  intl,
}: {
  href: string | null
  intl: ReturnType<typeof useIntl>
}) {
  if (href) {
    return (
      <a
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        className='inline-flex items-center gap-1 font-medium text-primary hover:underline'
      >
        {intl.formatMessage({
          id: 'boundary.editChange.viewPr',
          defaultMessage: 'View PR',
        })}
        <ExternalLink className='size-3' aria-hidden />
      </a>
    )
  }
  return (
    <span className='italic'>
      {intl.formatMessage({
        id: 'boundary.editChange.noPr',
        defaultMessage: 'No linked PR',
      })}
    </span>
  )
}

function Snippet({
  label,
  tone,
  text,
}: {
  label: string
  tone: 'danger' | 'success'
  text: string
}) {
  const cls =
    tone === 'danger'
      ? 'border-danger-border bg-danger-subtle/40'
      : 'border-success-border bg-success-subtle/40'
  return (
    <div className={`rounded-md border px-2 py-1.5 ${cls}`}>
      <span className='mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
        {label}
      </span>
      <pre className='max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground'>
        {text}
      </pre>
    </div>
  )
}

function Badge({
  tone,
  children,
}: {
  tone: 'warning' | 'danger' | 'muted'
  children: React.ReactNode
}) {
  const cls =
    tone === 'warning'
      ? 'bg-warning-subtle text-warning'
      : tone === 'danger'
        ? 'bg-danger-subtle text-danger'
        : 'bg-muted text-muted-foreground'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {children}
    </span>
  )
}
