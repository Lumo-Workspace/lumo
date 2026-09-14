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
import { BOUNDARY_CROSSINGS_ANCHOR } from './taskTabs'
import {
  useBoundaryCrossings,
  type BoundaryCrossingView,
  type CrossingAttributionView,
  type EditChangeView,
  type SuppressionPreview,
} from '../../hooks/useBoundaryCrossings'
import type { WorkspaceMemberInfo } from '../../types'
import { InfoTooltip } from './InfoTooltip'
import {
  boundaryCategoryLabel,
  boundaryDispositionLabel,
  boundaryDispositionOrOpenLabel,
  boundaryReversibilityLabel,
  boundarySeverityLabel,
} from './boundary-format'
import { systemExplainState } from './boundary-explain'
import { groupCrossings, type CrossingGroup } from './crossing-groups'
export { systemExplainState } from './boundary-explain'

/**
 * Returns 'advisory' when the crossing is advisory (non-blocking), null when
 * it is a blocking crossing. Pure — no intl dependency so it is unit-testable
 * without a provider (LUM-590).
 */
export function advisoryLabelFor(v: BoundaryCrossingView): string | null {
  return v.advisory ? 'advisory' : null
}

/**
 * Returns the three-field structured display for a project-rule crossing, or
 * null for crossings without a policyRuleText (non-project-rule categories).
 * Pure — no intl dependency, jsdom-testable (LUM-590).
 */
export function crossingFieldsFor(c: {
  policyRuleText: string | null
  detail: string
  agentContext: string | null
}): { rule: string; triggeredBy: string; whatHappened: string | null } | null {
  if (!c.policyRuleText) return null
  return {
    rule: c.policyRuleText,
    triggeredBy: c.detail,
    whatHappened: c.agentContext ?? null,
  }
}

interface BoundaryCrossingsPanelProps {
  taskIdentifier: string
  enabled: boolean
  /** Workspace URL slug, for linking a remediation task to its detail page. */
  workspaceUrl?: string
  members?: WorkspaceMemberInfo[]
  agentActors?: { actorId: string; name: string }[]
  /** Refresh the acceptance banner after a disposition/remediation changes state. */
  onChanged?: () => void
  /**
   * LUM-496: which slice of the task's crossings this instance renders.
   * 'open' = still awaiting a disposition (the NEEDS ACTION zone),
   * 'dispositioned' = already ruled on (the records zone),
   * 'all' (default) = every crossing, the pre-LUM-496 behaviour.
   */
  subset?: 'open' | 'dispositioned' | 'all'
  /** Anchor id for deep links; defaults to the historic `#boundary-crossings`. */
  anchorId?: string
  /**
   * LUM-496 prep (Task 5): an additional anchor id kept alive for old deep
   * links that still point at the pre-split id. When set, an empty
   * `<span id={legacyAnchorId} />` renders immediately before the panel root,
   * and the hash-scroll effect also fires for this id. Undefined by default —
   * no change for today's callers.
   */
  legacyAnchorId?: string
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
  subset = 'all',
  anchorId = BOUNDARY_CROSSINGS_ANCHOR,
  legacyAnchorId,
}: BoundaryCrossingsPanelProps) {
  const intl = useIntl()
  // gateEnabled defaults true on destructure too — an older mock/response
  // without the field must err toward "open blocks", never silently not.
  const {
    crossings,
    gateEnabled = true,
    refresh,
  } = useBoundaryCrossings({
    identifier: taskIdentifier,
    enabled,
  })
  const [pending, setPending] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  // LUM-751: per-crossing opt-in to a repository suppression rule + its reason.
  const [suppress, setSuppress] = useState<Record<string, boolean>>({})
  const [suppressReasons, setSuppressReasons] = useState<
    Record<string, string>
  >({})
  // LUM-759: the blast radius of the rule the human is about to create — how
  // many ALREADY-RECORDED alerts of the same kind in this repository it will
  // dispose alongside this one. Fetched when the opt-in is ticked, so the
  // number is shown before the ruling is committed, never after.
  const [suppressPreviews, setSuppressPreviews] = useState<
    Record<string, SuppressionPreview | 'loading'>
  >({})

  const toggleSuppress = (crossingId: string, on: boolean) => {
    setSuppress(prev => ({ ...prev, [crossingId]: on }))
    if (!on || suppressPreviews[crossingId]) return
    setSuppressPreviews(prev => ({ ...prev, [crossingId]: 'loading' }))
    void tasksClient
      .previewCrossingSuppressionScope<SuppressionPreview>(
        taskIdentifier,
        crossingId
      )
      .then(preview =>
        setSuppressPreviews(prev => ({ ...prev, [crossingId]: preview }))
      )
      .catch(() =>
        // Advisory only — a failed preview must never block the ruling itself,
        // so the count line just stays absent.
        setSuppressPreviews(prev =>
          Object.fromEntries(
            Object.entries(prev).filter(([key]) => key !== crossingId)
          )
        )
      )
  }

  // LUM-496: an instance renders one slice of the task's crossings; 'all' keeps
  // the historic single-panel behaviour for callers that pass no subset.
  const visible =
    subset === 'open'
      ? crossings.filter(c => c.disposition == null)
      : subset === 'dispositioned'
        ? crossings.filter(c => c.disposition != null)
        : crossings
  const openCrossings = visible.filter(c => c.disposition == null)
  const openCount = openCrossings.length
  // LUM-635: the subset that actually blocks DONE, mirroring the server gate
  // (assertNoUnacknowledgedBoundaryCrossings): advisory never blocks (LUM-590);
  // with the workspace gate opted out only HIGH still blocks (LUM-442).
  const blockingCount = openCrossings.filter(
    c => !c.advisory && (gateEnabled || c.severity === 'HIGH')
  ).length

  const [expanded, setExpanded] = useState(
    () => subset !== 'dispositioned' && openCount > 0
  )
  const prevOpen = useRef(openCount)
  useEffect(() => {
    if (openCount > prevOpen.current) setExpanded(true) // re-open if a new undisposed crossing arrives
    prevOpen.current = openCount
  }, [openCount])

  // Per-category group folds (LUM-496). A manual toggle sticks; until then the
  // first group holding an open, non-advisory crossing is the one open by
  // default — the decision the reviewer has to make next.
  const groups = groupCrossings(visible, { gateEnabled })
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>(
    {}
  )
  const defaultOpenCategory =
    subset === 'dispositioned'
      ? null
      : (groups.find(g =>
          g.crossings.some(
            c =>
              c.disposition == null &&
              !c.advisory &&
              (gateEnabled || c.severity === 'HIGH')
          )
        )?.category ?? null)
  const isGroupOpen = (g: CrossingGroup) =>
    groupOverrides[g.category] ?? g.category === defaultOpenCategory
  const toggleGroup = (g: CrossingGroup) =>
    setGroupOverrides(prev => ({
      ...prev,
      [g.category]: !(prev[g.category] ?? g.category === defaultOpenCategory),
    }))

  // Hash deep link (the verdict bar's "Review the crossings below" link routes
  // to /record#boundary-crossings). The panel mounts AFTER that navigation, so
  // the browser's native fragment jump finds nothing — scroll ourselves into
  // view once we actually render (crossings loaded), if the hash names us.
  const panelRef = useRef<HTMLDivElement>(null)
  const hasCrossings = visible.length > 0
  useEffect(() => {
    if (!hasCrossings) return
    if (typeof window === 'undefined') return
    const hash = window.location.hash
    if (
      hash !== `#${anchorId}` &&
      (!legacyAnchorId || hash !== `#${legacyAnchorId}`)
    )
      return
    panelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [hasCrossings, anchorId, legacyAnchorId])

  if (!hasCrossings) return null

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
    // LUM-751: the repository-rule opt-in rides a FALSE_POSITIVE ruling only;
    // the option argument is passed only when ticked, so the plain call shape
    // (and its callers' expectations) is unchanged otherwise.
    const wantsRule =
      verdict === 'FALSE_POSITIVE' && suppress[crossingId] === true
    const reason = suppressReasons[crossingId]?.trim()
    void tasksClient
      .dispositionBoundaryCrossing<{ retroactivelySuppressed?: number }>(
        taskIdentifier,
        crossingId,
        verdict,
        note || undefined,
        ...(wantsRule
          ? [
              {
                suppressSimilarInProject: true,
                ...(reason ? { suppressionReason: reason } : {}),
              },
            ]
          : [])
      )
      .then(res => {
        // LUM-759: a rule now clears the repository's existing alerts too —
        // report how many, so the click's real effect is visible.
        const swept = res?.retroactivelySuppressed ?? 0
        toast.success(
          verdict === 'OPEN'
            ? intl.formatMessage({
                id: 'boundary.toast.reopened',
                defaultMessage: 'Crossing reopened — Done is blocked again',
              })
            : wantsRule && swept > 0
              ? intl.formatMessage(
                  {
                    id: 'boundary.toast.ruleCreatedWithSweep',
                    defaultMessage:
                      'Repository rule created — {count, plural, one {# existing alert} other {# existing alerts}} of the same kind dispositioned, and future occurrences will be auto-handled',
                  },
                  { count: swept }
                )
              : wantsRule
                ? intl.formatMessage({
                    id: 'boundary.toast.ruleCreated',
                    defaultMessage:
                      'Crossing dispositioned and a repository rule created — future occurrences will be auto-handled',
                  })
                : intl.formatMessage({
                    id: 'boundary.toast.dispositioned',
                    defaultMessage:
                      'Crossing dispositioned — Done is unblocked',
                  })
        )
        afterChange()
      })
      .catch(errorToast)
      .finally(() => setPending(null))
  }

  // LUM-751: soft-revoke the repository rule behind an auto-suppressed
  // crossing — future occurrences record OPEN again. Human-only server-side.
  const revokeRule = (crossingId: string, ruleId: string) => {
    setPending(crossingId)
    void tasksClient
      .revokeCrossingSuppressionRule<{ reopenedCount?: number }>(
        taskIdentifier,
        ruleId
      )
      .then(res => {
        // LUM-759: revoking also puts back what the rule had silenced.
        const reopened = res?.reopenedCount ?? 0
        toast.success(
          reopened > 0
            ? intl.formatMessage(
                {
                  id: 'boundary.toast.ruleRevokedWithReopen',
                  defaultMessage:
                    'Rule revoked — {count, plural, one {# alert} other {# alerts}} it had auto-handled are open again',
                },
                { count: reopened }
              )
            : intl.formatMessage({
                id: 'boundary.toast.ruleRevoked',
                defaultMessage:
                  'Rule revoked — future occurrences will be open again',
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
    // LUM-635: the panel is a zone sibling of the human/machine criteria zones
    // (same row grammar — colored border, status header, dispositioned/total
    // count). Blocking open crossings escalate to danger; converged (all
    // dispositioned) reads neutral gray — handled isn't an achievement.
    <>
      {/* LUM-496 prep (Task 5): keeps an old deep link (e.g. #boundary-crossings)
      landing on the panel even after the id it targets moves to legacyAnchorId. */}
      {legacyAnchorId && <span id={legacyAnchorId} />}
      <div
        id={anchorId}
        ref={panelRef}
        className={`overflow-hidden rounded-lg border ${
          blockingCount > 0 ? 'border-danger-border' : 'border-border'
        }`}
      >
        <button
          type='button'
          data-testid='boundary-summary-toggle'
          aria-expanded={expanded}
          onClick={() => setExpanded(e => !e)}
          className={`flex w-full items-center gap-2 px-4 py-2.5 text-left ${
            blockingCount > 0 ? 'bg-danger-subtle' : 'bg-muted/30'
          }`}
        >
          <ChevronRight
            className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
            aria-hidden
          />
          {blockingCount > 0 ? (
            <AlertTriangle
              className='size-4 shrink-0 text-danger'
              aria-hidden
            />
          ) : (
            <ShieldCheck
              className='size-4 shrink-0 text-muted-foreground'
              aria-hidden
            />
          )}
          <span className='text-body-strong text-foreground'>
            {subset === 'dispositioned'
              ? intl.formatMessage({
                  id: 'record.crossings.resolvedTitle',
                  defaultMessage: 'Boundary crossings · dispositioned',
                })
              : intl.formatMessage({
                  id: 'boundary.panel.title',
                  defaultMessage: 'Boundary crossings',
                })}
          </span>
          {subset === 'dispositioned' ? null : (
            <span
              className={`text-caption ${
                blockingCount > 0 ? 'text-danger' : 'text-muted-foreground/70'
              }`}
            >
              {subset === 'open'
                ? blockingCount > 0
                  ? intl.formatMessage(
                      {
                        id: 'record.crossings.openTitle',
                        defaultMessage:
                          '{count} open — blocks Done until dispositioned',
                      },
                      { count: openCount }
                    )
                  : intl.formatMessage(
                      {
                        id: 'boundary.zone.openNonBlocking',
                        defaultMessage: '{count} open — non-blocking',
                      },
                      { count: openCount }
                    )
                : blockingCount > 0
                  ? intl.formatMessage(
                      {
                        id: 'boundary.zone.blocksDone',
                        defaultMessage:
                          '{count} open — blocks Done until dispositioned',
                      },
                      { count: blockingCount }
                    )
                  : openCount > 0
                    ? intl.formatMessage(
                        {
                          id: 'boundary.zone.openNonBlocking',
                          defaultMessage: '{count} open — non-blocking',
                        },
                        { count: openCount }
                      )
                    : intl.formatMessage(
                        {
                          id: 'boundary.zone.allDispositioned',
                          defaultMessage:
                            'All {count} dispositioned — none blocking',
                        },
                        { count: visible.length }
                      )}
            </span>
          )}
          <span className='ml-auto text-caption text-muted-foreground'>
            {subset === 'dispositioned'
              ? visible.length
              : `${visible.length - openCount}/${visible.length}`}
          </span>
        </button>

        {expanded && (
          <div className='border-t border-border px-4 py-3'>
            {blockingCount > 0 && (
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

            {/* LUM-496: crossings are grouped by category so a long queue reads
          as a handful of decisions. Only the wrapper groups — every per-crossing
          affordance below is unchanged. */}
            <div className='space-y-2'>
              {groups.map(g => (
                <div
                  key={g.category}
                  className='overflow-hidden rounded-md border border-border'
                >
                  <button
                    type='button'
                    data-testid={`crossing-group-${g.category}`}
                    aria-expanded={isGroupOpen(g)}
                    onClick={() => toggleGroup(g)}
                    className='flex w-full flex-wrap items-center gap-2 bg-muted/20 px-3 py-2 text-left'
                  >
                    <ChevronRight
                      className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                        isGroupOpen(g) ? 'rotate-90' : ''
                      }`}
                      aria-hidden
                    />
                    <span className='text-[13px] font-medium text-foreground'>
                      {boundaryCategoryLabel(g.category, intl)}
                    </span>
                    <Badge
                      tone={
                        g.severity === 'HIGH'
                          ? 'danger'
                          : g.severity === 'LOW'
                            ? 'muted'
                            : 'warning'
                      }
                    >
                      {intl.formatMessage(
                        {
                          id: 'boundary.panel.severityBadge',
                          defaultMessage: '{severity} severity',
                        },
                        { severity: boundarySeverityLabel(g.severity, intl) }
                      )}
                    </Badge>
                    {/* LUM-590: a group whose every crossing is advisory never
                  blocks Done — said in words, not in a new colour. */}
                    {g.advisory && (
                      <span className='text-caption text-muted-foreground'>
                        {' · '}
                        {intl.formatMessage({
                          id: 'record.crossings.advisory',
                          defaultMessage: 'advisory',
                        })}
                      </span>
                    )}
                    <span className='ml-auto text-caption text-muted-foreground'>
                      {intl.formatMessage(
                        {
                          id: 'record.crossings.groupCount',
                          defaultMessage: '{open} open / {total}',
                        },
                        { open: g.open, total: g.total }
                      )}
                    </span>
                  </button>

                  {isGroupOpen(g) && (
                    <div className='space-y-2 border-t border-border px-3 py-2'>
                      {g.crossings.map(c => (
                        <CrossingRow
                          key={c.id}
                          crossing={c}
                          intl={intl}
                          taskIdentifier={taskIdentifier}
                          workspaceUrl={workspaceUrl}
                          pending={pending === c.id}
                          note={notes[c.id] ?? ''}
                          reviewerName={reviewerName(c.dispositionedById)}
                          ownerName={ownerName(
                            c.attribution?.workspaceMemberId ?? null
                          )}
                          changeReviewerName={reviewerName(
                            c.lastDispositionChange?.actorId ?? null
                          )}
                          onNote={v =>
                            setNotes(prev => ({ ...prev, [c.id]: v }))
                          }
                          onDisposition={verdict => disposition(c.id, verdict)}
                          onSpawnRemediation={() => spawnRemediation(c.id)}
                          onExplainDone={afterChange}
                          suppress={suppress[c.id] ?? false}
                          suppressReason={suppressReasons[c.id] ?? ''}
                          onSuppressChange={v => toggleSuppress(c.id, v)}
                          suppressPreview={suppressPreviews[c.id]}
                          onSuppressReason={v =>
                            setSuppressReasons(prev => ({
                              ...prev,
                              [c.id]: v,
                            }))
                          }
                          onRevokeRule={() => {
                            if (c.suppressionRule)
                              revokeRule(c.id, c.suppressionRule.id)
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
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
          </div>
        )}
      </div>
    </>
  )
}

function CrossingRow({
  crossing: c,
  intl,
  taskIdentifier,
  workspaceUrl,
  pending,
  note,
  reviewerName,
  ownerName,
  changeReviewerName,
  onNote,
  onDisposition,
  onSpawnRemediation,
  onExplainDone,
  suppress,
  suppressReason,
  onSuppressChange,
  suppressPreview,
  onSuppressReason,
  onRevokeRule,
}: {
  crossing: BoundaryCrossingView
  intl: ReturnType<typeof useIntl>
  taskIdentifier: string
  workspaceUrl: string
  pending: boolean
  note: string
  reviewerName: string | null
  ownerName: string | null
  changeReviewerName: string | null
  onNote: (v: string) => void
  onDisposition: (verdict: 'FALSE_POSITIVE' | 'CONFIRMED' | 'OPEN') => void
  onSpawnRemediation: () => void
  onExplainDone: () => void
  /** LUM-751: repository-rule opt-in state + revoke. */
  suppress: boolean
  suppressReason: string
  onSuppressChange: (v: boolean) => void
  /** LUM-759: how many existing alerts the rule would dispose too. */
  suppressPreview: SuppressionPreview | 'loading' | undefined
  onSuppressReason: (v: string) => void
  onRevokeRule: () => void
}) {
  const [cmdOpen, setCmdOpen] = useState(false)
  const [explainLoading, setExplainLoading] = useState(false)

  const requestExplanation = () => {
    setExplainLoading(true)
    void tasksClient
      .explainBoundaryCrossing<{ explanation: string }>(taskIdentifier, c.id)
      .then(() => {
        onExplainDone()
      })
      .catch(() => {
        toast.error(
          intl.formatMessage({
            id: 'boundary.toast.error',
            defaultMessage: 'Action failed — please try again',
          })
        )
      })
      .finally(() => setExplainLoading(false))
  }
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
      <div
        role='button'
        tabIndex={0}
        onClick={() => setCollapsed(v => !v)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setCollapsed(v => !v)
          }
        }}
        aria-expanded={!collapsed}
        data-testid={`crossing-toggle-${c.id}`}
        className='flex w-full flex-wrap items-center gap-2 text-left'
      >
        <ChevronRight
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${collapsed ? '' : 'rotate-90'}`}
          aria-hidden
        />
        <span className='inline-flex items-center gap-1 text-[13px] font-medium text-foreground'>
          {boundaryCategoryLabel(c.category, intl)}
          <InfoTooltip
            label={intl.formatMessage({
              id: 'boundary.tip.category',
              defaultMessage:
                'A boundary crossing is a forbidden or risky action the agent took. The category says what kind.',
            })}
          />
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
        <InfoTooltip
          label={intl.formatMessage({
            id: 'boundary.tip.severity',
            defaultMessage:
              'How serious this crossing is. HIGH crossings block marking the task Done until resolved.',
          })}
        />
        {/* LUM-590: advisory crossings never block DONE — distinguish them from
        blocking ones via typography (muted badge), not a new color. */}
        {advisoryLabelFor(c) && (
          <Badge tone='muted'>
            {intl.formatMessage({
              id: 'boundary.advisoryBadge',
              defaultMessage: 'Advisory',
            })}
          </Badge>
        )}
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
        {/* LUM-478: a system auto-resolution — on record + auditable but out of
        the open queue and non-blocking. Distinct badge so an auditor reads it as
        "detector auto-cleared (legit)", not a human ruling. */}
        {c.disposition === 'AUTO_LEGIT' && (
          <Badge tone='muted'>
            {boundaryDispositionLabel('AUTO_LEGIT', intl)}
          </Badge>
        )}
        {/* LUM-751: system-dispositioned by a human-authored repository rule —
        on record, out of the open queue, non-blocking; revocable below. */}
        {c.disposition === 'AUTO_SUPPRESSED' && (
          <Badge tone='muted'>
            {boundaryDispositionLabel('AUTO_SUPPRESSED', intl)}
          </Badge>
        )}
        {c.disposition ? (
          <InfoTooltip
            label={intl.formatMessage({
              id: 'boundary.tip.disposition',
              defaultMessage:
                'How this crossing was resolved: false positive (not a real issue), confirmed (a real issue), auto-cleared by the system, or auto-dispositioned by a repository rule a human created.',
            })}
          />
        ) : null}
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
          {/* LUM-769: a ruling relayed through the CLI is shown as such — the
          server cannot verify the in-chat approval, so it never passes as a
          panel click. */}
          {!open && c.dispositionChannel === 'CLI' && (
            <span
              data-testid={`boundary-via-cli-${c.id}`}
              className='ml-1'
              title={intl.formatMessage({
                id: 'boundary.panel.viaCliTip',
                defaultMessage:
                  'Ruled from the terminal with lumo crossing disposition --confirm: the agent relayed the crossing and the user approved in chat. Correct it here if that approval was not yours.',
              })}
            >
              {intl.formatMessage({
                id: 'boundary.panel.viaCli',
                defaultMessage: '· via CLI',
              })}
            </span>
          )}
        </span>
      </div>

      {!collapsed && (
        <>
          {(() => {
            const fields = crossingFieldsFor(c)
            if (fields) {
              return (
                <div className='mt-1.5 space-y-1 text-[11px]'>
                  <div className='flex gap-1.5'>
                    <span className='shrink-0 text-muted-foreground'>
                      {intl.formatMessage({
                        id: 'boundary.field.rule',
                        defaultMessage: 'Rule',
                      })}
                      :
                    </span>
                    <span className='text-foreground'>{fields.rule}</span>
                  </div>
                  <div className='flex gap-1.5'>
                    <span className='shrink-0 text-muted-foreground'>
                      {intl.formatMessage({
                        id: 'boundary.field.triggeredBy',
                        defaultMessage: 'Triggered by',
                      })}
                      :
                    </span>
                    <code
                      data-testid={`crossing-cmd-${c.id}`}
                      onClick={() => setCmdOpen(o => !o)}
                      className={`cursor-pointer rounded-md bg-muted/60 px-2 py-1 font-mono text-[11px] text-foreground ${cmdOpen ? 'whitespace-pre-wrap break-all' : 'truncate whitespace-nowrap'}`}
                      title={cmdOpen ? undefined : fields.triggeredBy}
                    >
                      {fields.triggeredBy}
                    </code>
                  </div>
                  {fields.whatHappened && (
                    <div className='flex gap-1.5'>
                      <span className='shrink-0 text-muted-foreground'>
                        {intl.formatMessage({
                          id: 'boundary.field.whatHappened',
                          defaultMessage: 'What happened',
                        })}
                        :
                      </span>
                      <span className='text-foreground italic'>
                        {fields.whatHappened}
                      </span>
                    </div>
                  )}
                </div>
              )
            }
            return (
              <code
                data-testid={`crossing-cmd-${c.id}`}
                onClick={() => setCmdOpen(o => !o)}
                className={`mt-1.5 block cursor-pointer rounded-md bg-muted/60 px-2 py-1 font-mono text-[11px] text-foreground ${cmdOpen ? 'whitespace-pre-wrap break-all' : 'truncate whitespace-nowrap'}`}
                title={cmdOpen ? undefined : c.detail}
              >
                {c.detail}
              </code>
            )
          })()}

          {/* LUM-572: reversibility + recurrence live in the expanded detail now,
          off the collapsed row which keeps only severity + disposition. */}
          <div className='mt-2 flex flex-wrap items-center gap-2'>
            <span data-testid={`crossing-reversible-${c.id}`}>
              <Badge tone={c.reversible ? 'muted' : 'danger'}>
                {c.reversible ? (
                  <Unlock className='size-3' aria-hidden />
                ) : (
                  <Lock className='size-3' aria-hidden />
                )}
                {boundaryReversibilityLabel(c.reversible, intl)}
              </Badge>
            </span>
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
                        {
                          at: new Date(c.lastSeenAt).toLocaleString(
                            intl.locale
                          ),
                        }
                      )
                    : undefined
                }
                className='inline-flex items-center gap-1 rounded-sm bg-warning-subtle px-2 py-0.5 text-[11px] font-medium text-warning'
              >
                <Repeat className='size-3' aria-hidden />
                {intl.formatMessage(
                  {
                    id: 'boundary.panel.recurrence',
                    defaultMessage: 'seen ×{count}',
                  },
                  { count: c.occurrenceCount }
                )}
                <InfoTooltip
                  label={intl.formatMessage({
                    id: 'boundary.tip.recurrence',
                    defaultMessage:
                      'This same crossing was detected multiple times; the count is how many times.',
                  })}
                />
              </span>
            )}
          </div>

          <AttributionLine
            attribution={c.attribution ?? UNKNOWN_ATTRIBUTION}
            ownerName={ownerName}
            intl={intl}
          />

          {/* LUM-542: append-only agent self-explanations ("申辩"). Explicitly
          framed as the agent's own unverified account — context for the
          reviewer's decision, never a verdict. Stays visible after disposition
          so it doubles as the retrospective record. */}
          {c.explanations && c.explanations.length > 0 && (
            <div
              data-testid={`crossing-explanations-${c.id}`}
              className='mt-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5'
            >
              <p className='flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground'>
                <Bot className='size-3.5 shrink-0' aria-hidden />
                {intl.formatMessage({
                  id: 'boundary.panel.explanations.label',
                  defaultMessage: 'Agent self-report · unverified',
                })}
              </p>
              <ul className='mt-1 space-y-1'>
                {c.explanations.map(ex => (
                  <li
                    key={ex.id}
                    className='whitespace-pre-wrap break-words text-[11px] text-foreground'
                  >
                    {ex.note}
                  </li>
                ))}
              </ul>
              <p className='mt-1 text-[10px] italic text-muted-foreground/80'>
                {intl.formatMessage({
                  id: 'boundary.panel.explanations.disclaimer',
                  defaultMessage:
                    "The agent's own account of why it acted — context for your decision, not a verdict, and never a disposition.",
                })}
              </p>
            </div>
          )}

          {/* LUM-590: system-generated plain-language explanation. When absent,
          show an "Explain" button (human-triggered LLM call). When present,
          render as a plain text node — NEVER dangerouslySetInnerHTML since the
          text derives from untrusted command content (same policy as the detail
          code block above). Advisory only — never clears a crossing or the DONE
          gate. */}
          {(() => {
            const explainState = systemExplainState(c)
            if (explainState.kind === 'text') {
              return (
                <div
                  data-testid={`crossing-system-explanation-${c.id}`}
                  className='mt-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5'
                >
                  <p className='mb-1 text-[11px] font-medium text-muted-foreground'>
                    {intl.formatMessage({
                      id: 'boundary.explain.label',
                      defaultMessage: 'Explanation',
                    })}
                  </p>
                  <p className='whitespace-pre-wrap break-words text-[11px] text-foreground'>
                    {explainState.text}
                  </p>
                </div>
              )
            }
            return (
              <button
                type='button'
                data-testid={`crossing-explain-btn-${c.id}`}
                disabled={explainLoading || pending}
                onClick={requestExplanation}
                className='mt-1.5 inline-flex items-center gap-1 rounded-sm border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50'
              >
                {explainLoading
                  ? intl.formatMessage({
                      id: 'boundary.explain.loading',
                      defaultMessage: 'Generating…',
                    })
                  : intl.formatMessage({
                      id: 'boundary.explain.button',
                      defaultMessage: 'Explain',
                    })}
              </button>
            )
          })()}

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

          {/* LUM-751: which repository rule auto-dispositioned this crossing,
          with a one-click soft revoke (human-only server-side). */}
          {c.suppressionRule && (
            <p
              className='mt-2 text-[11px] text-muted-foreground'
              data-testid={`crossing-suppression-rule-${c.id}`}
            >
              {intl.formatMessage(
                {
                  id: 'boundary.panel.suppressedByRule',
                  defaultMessage:
                    'Auto-dispositioned by repository rule {rule}{reason}',
                },
                {
                  rule: c.suppressionRule.id.slice(0, 8),
                  reason: c.suppressionRule.reason
                    ? ` — ${c.suppressionRule.reason}`
                    : '',
                }
              )}
              {c.suppressionRule.revokedAt ? (
                <span>
                  {' · '}
                  {intl.formatMessage({
                    id: 'boundary.panel.ruleRevoked',
                    defaultMessage: 'rule revoked',
                  })}
                </span>
              ) : (
                <button
                  type='button'
                  data-testid={`boundary-revoke-rule-${c.id}`}
                  disabled={pending}
                  onClick={onRevokeRule}
                  className='ml-2 underline hover:text-foreground disabled:opacity-50'
                >
                  {intl.formatMessage({
                    id: 'boundary.panel.revokeRule',
                    defaultMessage: 'Revoke rule',
                  })}
                </button>
              )}
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
              {/* LUM-751: per-repository auto-handle opt-in — only for a
              suppressible category with a coalescing target; never on the
              HIGH classes (the server refuses those with 422 anyway). */}
              {c.suppressible && (
                <label className='flex items-center gap-2 text-[11px] text-muted-foreground'>
                  <input
                    type='checkbox'
                    data-testid={`boundary-suppress-similar-${c.id}`}
                    checked={suppress}
                    disabled={pending}
                    onChange={e => onSuppressChange(e.target.checked)}
                  />
                  {intl.formatMessage({
                    id: 'boundary.panel.suppressSimilar',
                    defaultMessage:
                      'Auto-handle this kind in this repository from now on (false positive only)',
                  })}
                </label>
              )}
              {/* LUM-759: the blast radius, before the ruling is committed —
              ticking the box will dispose this repository's existing alerts of
              the same kind too, so say how many. */}
              {c.suppressible &&
                suppress &&
                suppressPreview &&
                suppressPreview !== 'loading' &&
                suppressPreview.count > 0 && (
                  <p
                    data-testid={`boundary-suppress-preview-${c.id}`}
                    className='text-[11px] text-muted-foreground'
                  >
                    {intl.formatMessage(
                      {
                        id: 'boundary.panel.suppressPreview',
                        defaultMessage:
                          'This will also dispose {count, plural, one {# existing alert} other {# existing alerts}} of the same kind in this repository.',
                      },
                      { count: suppressPreview.count }
                    )}
                    {suppressPreview.capped
                      ? ` ${intl.formatMessage(
                          {
                            id: 'boundary.panel.suppressPreviewCapped',
                            defaultMessage:
                              'More than {cap} match — only the {cap} most recent are handled.',
                          },
                          { cap: suppressPreview.cap }
                        )}`
                      : ''}
                  </p>
                )}
              {c.suppressible && suppress && (
                <input
                  type='text'
                  data-testid={`boundary-suppress-reason-${c.id}`}
                  value={suppressReason}
                  disabled={pending}
                  onChange={e => onSuppressReason(e.target.value)}
                  placeholder={intl.formatMessage({
                    id: 'boundary.panel.suppressReasonPlaceholder',
                    defaultMessage:
                      'Why this is never a real crossing here (optional)',
                  })}
                  className='w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring'
                />
              )}
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
                    defaultMessage: 'Undo disposition (re-block Done)',
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
                  <span className='rounded-sm border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground'>
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
      className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {children}
    </span>
  )
}
