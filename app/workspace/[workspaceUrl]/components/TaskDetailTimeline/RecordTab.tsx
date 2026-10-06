'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { useTaskStatus } from '../../hooks/useTaskStatus'
import { useBoundaryCrossings } from '../../hooks/useBoundaryCrossings'
import type { WorkspaceMemberInfo } from '../../types'
import { BoundaryCrossingsPanel } from './BoundaryCrossingsPanel'
import { BOUNDARY_CROSSINGS_ANCHOR } from './taskTabs'
import { deriveRecordGaps } from './record-gaps'
import { deriveDoneGate } from './done-gate'
import { RecordDoneGate } from './RecordDoneGate'
import { RunReportTiles } from './RunReportTiles'
import { deriveRunReportTiles } from './run-report-tiles'

/** Anchor of the Needs action section — the Done gate's rows link here. */
const NEEDS_ACTION_ANCHOR = 'record-needs-action'

interface RecordTabProps {
  taskIdentifier: string
  enabled: boolean
  /** Workspace URL slug, for linking a spawned remediation task from the panel. */
  workspaceUrl?: string
  /** For resolving the disposition reviewer's name on the crossings panel. */
  members?: WorkspaceMemberInfo[]
  agentActors?: { actorId: string; name: string }[]
  /** LUM-1009: how many undispositioned security findings hard-block DONE
   *  (LUM-496). */
  securityBlocking?: number
  /** LUM-1009: the task has at least one scanned PR — without one the Done
   *  gate says "not scanned", never "no blocking findings". */
  securityScanned?: boolean
  /** LUM-1009: the blocking security findings, acted on in Needs action
   *  (`BlockingSecurityFindings`). Rendered only while `securityBlocking > 0`. */
  blockingSecuritySlot?: ReactNode
  /** LUM-1009: the full security scan report — always in Records. */
  securityRecordSlot?: ReactNode
  /** LUM-572/1009: the evidence rows (agent runs, lineage, memory), at the
   *  tail of Records. */
  evidenceSlot?: ReactNode
  /** LUM-932/1009: sessions bound explicitly vs auto-detected (Sessions tile). */
  attribution?: { explicit: number; inferred: number }
  /** LUM-932: some of the task's cost was split by auto-detection — the Cost
   *  tile says so. */
  costApproximate?: boolean
  /** LUM-932: some run predates the usage-dedupe fix (Cost tile marker). */
  costPreDedupe?: boolean
}

function SectionHeading({
  id,
  title,
  note,
}: {
  id: string
  title: string
  note?: string
}) {
  return (
    <div className='flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5'>
      <h3 id={id} className='text-title text-foreground'>
        {title}
      </h3>
      {note ? (
        <p className='text-caption text-muted-foreground'>{note}</p>
      ) : null}
    </div>
  )
}

/**
 * The Record tab body (LUM-1009): four fixed sections, top to bottom —
 * ① the Done gate (can this task reach Done?), ② Needs action (only when
 * something does: open crossings, blocking security findings), ③ the Run
 * overview tiles, ④ Records (settled facts, one fold level). Sections never
 * swap places as the task's state changes.
 */
export function RecordTab({
  taskIdentifier,
  enabled,
  workspaceUrl = '',
  members = [],
  agentActors = [],
  securityBlocking = 0,
  securityScanned = false,
  blockingSecuritySlot,
  securityRecordSlot,
  evidenceSlot,
  attribution = { explicit: 0, inferred: 0 },
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
    return (
      <div className='py-8 text-center text-xs text-danger-text'>{error}</div>
    )
  }

  if (!data) return null

  const gaps = deriveRecordGaps({
    taskStatus: data.task.status,
    crossings,
    gateEnabled,
    securityBlocking,
  })
  const gate = deriveDoneGate(gaps, { securityScanned })
  const showSecurityQueue = gaps.securityBlocking > 0
  const hasNeedsAction = gaps.crossingsOpen > 0 || showSecurityQueue
  // The note has to match what the section actually contains (LUM-496 review
  // F4/F5): nothing gates a decision already taken, and advisory-only items
  // need a disposition but never held Done back.
  const needsActionNoteId = gaps.taskDone
    ? 'record.zone.needsActionDoneNote'
    : gaps.crossingsBlocking === 0 && gaps.securityBlocking === 0
      ? 'record.zone.needsActionAdvisoryNote'
      : 'record.zone.needsActionNote'

  const refreshStatus = () => {
    void refresh()
  }

  return (
    <div className='space-y-8 py-1'>
      {/* ① Done gate — always on the tab. */}
      <RecordDoneGate
        gate={gate}
        queueAnchor={hasNeedsAction ? NEEDS_ACTION_ANCHOR : null}
      />

      {/* ② Needs action — everything whose resolution moves the task toward
          Done. Rendered only when it has at least one item. */}
      {hasNeedsAction ? (
        <section
          id={NEEDS_ACTION_ANCHOR}
          data-testid='record-needs-action'
          aria-labelledby='record-needs-action-title'
          className='space-y-3'
        >
          <SectionHeading
            id='record-needs-action-title'
            title={intl.formatMessage({ id: 'record.zone.needsAction' })}
            note={intl.formatMessage({ id: needsActionNoteId })}
          />

          {/* Open crossings — each needs a human disposition. `legacyAnchorId`
              keeps the #boundary-crossings deep link (LUM-454) landing here. */}
          {gaps.crossingsOpen > 0 ? (
            <BoundaryCrossingsPanel
              taskIdentifier={taskIdentifier}
              enabled={enabled}
              workspaceUrl={workspaceUrl}
              members={members}
              agentActors={agentActors}
              onChanged={refreshStatus}
              subset='open'
              anchorId='record-crossings'
              legacyAnchorId={BOUNDARY_CROSSINGS_ANCHOR}
            />
          ) : null}

          {/* LUM-732: a blocking finding hard-blocks DONE (the API returns
              409) — only those findings come up here; the full report stays
              in Records below. */}
          {showSecurityQueue ? blockingSecuritySlot : null}
        </section>
      ) : null}

      {/* ③ Run overview. */}
      <section
        data-testid='record-overview'
        aria-labelledby='record-overview-title'
        className='space-y-3'
      >
        <SectionHeading
          id='record-overview-title'
          title={intl.formatMessage({ id: 'record.overview.title' })}
        />
        <RunReportTiles
          tiles={deriveRunReportTiles(data, attribution)}
          costApproximate={costApproximate}
          preDedupe={costPreDedupe}
        />
      </section>

      {/* ④ Records — settled facts: kept, legible, one click away. */}
      <section
        data-testid='record-records'
        aria-labelledby='record-records-title'
        className='space-y-3'
      >
        <SectionHeading
          id='record-records-title'
          title={intl.formatMessage({ id: 'record.records.title' })}
          note={intl.formatMessage({ id: 'record.records.note' })}
        />
        <div className='space-y-2'>
          {securityRecordSlot}

          {/* Crossings already ruled on — who decided what. Renders null when
              there are none. Carries the legacy #boundary-crossings anchor
              whenever no open-subset panel above carries it (one id, one
              element). */}
          <BoundaryCrossingsPanel
            taskIdentifier={taskIdentifier}
            enabled={enabled}
            workspaceUrl={workspaceUrl}
            members={members}
            agentActors={agentActors}
            onChanged={refreshStatus}
            subset='dispositioned'
            anchorId='record-crossings-dispositioned'
            {...(gaps.crossingsOpen === 0
              ? { legacyAnchorId: BOUNDARY_CROSSINGS_ANCHOR }
              : {})}
          />

          {evidenceSlot}
        </div>
      </section>
    </div>
  )
}
