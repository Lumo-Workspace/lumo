'use client'

import { useState, type ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { ChevronRight } from 'lucide-react'
import { useTaskStatus } from '../../hooks/useTaskStatus'
import { useBoundaryCrossings } from '../../hooks/useBoundaryCrossings'
import type { WorkspaceMemberInfo } from '../../types'
import { BoundaryCrossingsPanel } from './BoundaryCrossingsPanel'
import { BOUNDARY_CROSSINGS_ANCHOR } from './taskTabs'
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

interface RecordTabProps {
  taskIdentifier: string
  enabled: boolean
  /** Workspace URL slug, for linking a spawned remediation task from the panel. */
  workspaceUrl?: string
  /** For resolving the disposition reviewer's name on the crossings panel. */
  members?: WorkspaceMemberInfo[]
  agentActors?: { actorId: string; name: string }[]
  /** LUM-572 — the dossier's evidence & causality sub-sections (agent runs,
   *  lineage, memory). Rendered at the tail of the Run report group so the whole
   *  after-the-fact record lives under one collapsible bucket. */
  evidenceSlot?: ReactNode
  /** LUM-732: per-PR security scan findings; null when the task has no PRs. */
  securitySlot?: ReactNode
  /** LUM-496: how many undispositioned security findings hard-block DONE.
   *  >0 moves `securitySlot` into the NEEDS ACTION zone; 0 (the default) leaves
   *  it in the records. */
  securityBlocking?: number
  /** Open the Run report group on mount — e.g. a legacy deep link targets an
   *  evidence sub-section nested inside it. */
  reportInitiallyOpen?: boolean
  /** LUM-932: the attribution summary, rendered right under the status strip. */
  attributionSlot?: ReactNode
  /** LUM-932: some of the task's cost was split by auto-detection — the Run
   *  report's Cost tile says so. */
  costApproximate?: boolean
  /** LUM-932: some run predates the usage-dedupe fix (Cost tile marker). */
  costPreDedupe?: boolean
}

/** LUM-496: the Run report group's initial fold state (see the tab body). */
const RUN_REPORT_OPEN_BY_DEFAULT = true

/** The uniform card for a top-level Record-tab group (LUM-581). */
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

/**
 * The Record tab body: the Done-gap strip, a NEEDS ACTION zone (open boundary
 * crossings, blocking security findings), and the settled records (ruled-on
 * crossings, security scan, Run report with cost / rework /
 * trend and the evidence sub-sections).
 */
export function RecordTab({
  taskIdentifier,
  enabled,
  workspaceUrl = '',
  members = [],
  agentActors = [],
  evidenceSlot,
  securitySlot,
  securityBlocking = 0,
  reportInitiallyOpen = false,
  attributionSlot,
  costApproximate = false,
  costPreDedupe = false,
}: RecordTabProps) {
  const intl = useIntl()
  const { data, loading, error, refresh } = useTaskStatus({
    identifier: taskIdentifier,
    enabled,
  })
  // LUM-496: the same react-query cache the crossings panel reads (one key →
  // one fetch). `gateEnabled` defaults to true — an older response without
  // the field must err toward "open blocks".
  const { crossings, gateEnabled = true } = useBoundaryCrossings({
    identifier: taskIdentifier,
    enabled,
  })
  // LUM-496: the Run report opens by default — its KPI tiles are the record's
  // glanceable summary. A legacy evidence deep link (`reportInitiallyOpen`)
  // needs exactly that; the prop stays so a future default flip can't
  // silently break those URLs.
  const [runReportOpen, setRunReportOpen] = useState<boolean>(
    reportInitiallyOpen || RUN_REPORT_OPEN_BY_DEFAULT
  )
  // LUM-496: the struggle trail folds behind its own heading inside the Run
  // report — the KPI tiles carry the headline numbers above it.
  const [struggleOpen, setStruggleOpen] = useState(false)

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

  if (!data) return null

  // ── LUM-496 · zone split ─────────────────────────────────────────────────
  // A unit sits in NEEDS ACTION iff acting on it changes whether the task can
  // reach Done — open boundary crossings, blocking security findings.
  // Everything else is a record.
  const gaps = deriveRecordGaps({
    taskStatus: data.task.status,
    crossings,
    gateEnabled,
    securityBlocking,
  })
  const showSecurityFirst = gaps.securityBlocking > 0
  const hasNeedsAction = gaps.crossingsOpen > 0 || showSecurityFirst
  // The zone's note has to match what the zone actually contains (review
  // F4/F5): nothing gates a decision already taken, and advisory-only items
  // need a disposition but never held Done back.
  const needsActionNoteId = gaps.taskDone
    ? 'record.zone.needsActionDoneNote'
    : gaps.crossingsOpen > 0 &&
        gaps.crossingsBlocking === 0 &&
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

  return (
    <div className='space-y-5 py-1'>
      {/* LUM-496: "still needed for Done", with anchor chips into each gap.
          The chips only link when the NEEDS ACTION zone (and therefore the
          anchors they point at) is actually on the page. */}
      <RecordStatusStrip gaps={gaps} interactive={hasNeedsAction} />
      {attributionSlot}

      {/* ── NEEDS ACTION ──────────────────────────────────────────────────
          Everything whose resolution moves the task toward Done. Rendered
          only when it has at least one child. */}
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

          {/* Open crossings — each needs a human disposition before Done.
              `legacyAnchorId` keeps the #boundary-crossings deep link
              (LUM-454) landing here. */}
          {gaps.crossingsOpen > 0 ? (
            <BoundaryCrossingsPanel
              taskIdentifier={taskIdentifier}
              enabled={enabled}
              workspaceUrl={workspaceUrl}
              members={members}
              agentActors={agentActors}
              onChanged={() => {
                void refresh()
              }}
              subset='open'
              anchorId='record-crossings'
              legacyAnchorId={BOUNDARY_CROSSINGS_ANCHOR}
            />
          ) : null}

          {/* LUM-732: an undispositioned blocking finding hard-blocks DONE
              (the API returns 409) — an action, not a record. Shown here
              instead of (never as well as) in the records below. */}
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
            void refresh()
          }}
          subset='dispositioned'
          anchorId='record-crossings-dispositioned'
          {...(gaps.crossingsOpen === 0
            ? { legacyAnchorId: BOUNDARY_CROSSINGS_ANCHOR }
            : {})}
        />

        {/* LUM-732: the security scan as a record, when nothing in it blocks
            (a blocking finding puts it in NEEDS ACTION above instead). */}
        {showSecurityFirst ? null : securitySlot}

        {/* LUM-572 · Run report — the after-the-fact record. LUM-496: the KPI
            tiles read at a glance; trend, struggle and the evidence
            sub-sections stay one click away below them. */}
        <DossierGroup
          title={intl.formatMessage({
            id: 'acceptance.runReport.title',
            defaultMessage: 'Run report',
          })}
          open={runReportOpen}
          onToggle={() => setRunReportOpen(o => !o)}
        >
          <div className='space-y-4'>
            <RunReportTiles
              tiles={deriveRunReportTiles(data)}
              costApproximate={costApproximate}
              preDedupe={costPreDedupe}
            />

            <TrendSection trend={data.trend} />

            {/* LUM-561's struggle trail, folded — the tiles carry the headline
                numbers; the scars they summarize are one click below. */}
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
                  <StruggleTrailSection trail={data.struggleTrail} headless />
                </div>
              ) : null}
            </div>

            {/* LUM-572: the evidence & causality sub-sections (agent runs,
                lineage, injected memory) fold in at the tail. */}
            {evidenceSlot}
          </div>
        </DossierGroup>
      </div>
    </div>
  )
}
