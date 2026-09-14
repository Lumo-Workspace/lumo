'use client'

import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronRight } from 'lucide-react'
import type { TaskDetail, WorkspaceMemberInfo } from '../../types'
import type { MentionSources } from '@/types/mention'
import type { DossierSection } from './taskTabs'
import { useAgentRuns } from '../../hooks/useAgentRuns'
import { useSecurityScans } from '../../hooks/useSecurityScans'
import { deriveRunDigest } from '../AgentRunTimeline/derive-run-digest'
import { AcceptanceTab } from './AcceptanceTab'
import { AgentRunsSection } from './AgentRunsSection'
import { DeliveryGatesSection } from '../DeliveryGatesSection'
import { SecurityScanSection } from './SecurityScanSection'
import { LineageTab } from './LineageTab'
import { MemoryTab } from '../memory/MemoryTab'
import { InfoTooltip } from './InfoTooltip'
import type { HumanVerdictResult } from './VerdictDecision'

interface TaskDossierProps {
  taskId: string
  taskIdentifier: string
  taskStatus: TaskDetail['status']
  agentStatus?: string | null | undefined
  workspaceUrl: string
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string }[]
  enabled: boolean
  onVerdictRecorded: (result: HumanVerdictResult) => void
  mentionSources?: MentionSources | undefined
  /** WorkspaceMember.id → name, for the ④ memory sub-section's "Added by X". */
  memberNames: Map<string, string>
  /** Presence of the ④ Lineage / Memory sub-sections — an empty sub-section is
   *  not drawn (the runs sub-section gates itself on runs presence). */
  hasLineage: boolean
  hasMemories: boolean
  /** A legacy deep link (delivery/lineage/memory) targets a ④ sub-section to
   *  expand + scroll to; null when landing on the dossier directly. */
  targetSection: DossierSection | null
}

/** One collapsible ④ sub-section. Expansion is parent-controlled so a deep link
 *  can open it; the anchor id lets the deep link scroll it into view. */
function EvidenceSubSection({
  section,
  title,
  summary,
  expanded,
  onToggle,
  children,
}: {
  section: DossierSection
  title: string
  summary?: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div
      id={`dossier-${section}`}
      className='overflow-hidden rounded-md border border-border'
    >
      <button
        type='button'
        aria-expanded={expanded}
        onClick={onToggle}
        className='flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors'
      >
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <span className='text-body-strong text-foreground'>{title}</span>
        {summary ? (
          <span className='ml-auto text-[11px] text-muted-foreground/80'>
            {summary}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div className='border-t border-border px-3 py-3'>{children}</div>
      ) : null}
    </div>
  )
}

/**
 * The decision-first task dossier (LUM-567): one surface that replaces the
 * former Delivery / Memory / Lineage tabs. Reads top-down as decision → why.
 *
 * The whole surface is {@link AcceptanceTab}: the decision head, claim, criteria
 * and boundary panel lead, and everything after-the-fact folds into one
 * collapsed "Run report" group — the honest-report metrics (cost / struggle /
 * trend / history / removed) plus, via the `evidenceSlot` prop, the three
 * evidence & causality sub-sections built here (LUM-572). The sub-sections stay
 * deep-linkable: an old Delivery / Lineage / Memory URL opens the Run report
 * group (`reportInitiallyOpen`) and expands its target region (LUM-458). Run
 * sessions are fetched once here (single source) and shared with the decision
 * head's count and the runs sub-section.
 */
export function TaskDossier({
  taskId,
  taskIdentifier,
  taskStatus,
  agentStatus,
  workspaceUrl,
  members,
  agentActors,
  enabled,
  onVerdictRecorded,
  mentionSources,
  memberNames,
  hasLineage,
  hasMemories,
  targetSection,
}: TaskDossierProps) {
  const intl = useIntl()
  const { data: runsData } = useAgentRuns({ taskId, enabled })
  const runs = runsData?.runs ?? []
  // Same two-layer rule as the run card: prefer the LLM-synthesized summary,
  // else fall back to the raw digest joined into one line, else nothing.
  const latestRunSummary =
    runs[0]?.runSummary ??
    (runs[0] ? deriveRunDigest(runs[0].items ?? []).join(' · ') || null : null)

  const hasRuns = runs.length > 0

  // LUM-496: the record tab needs to know whether a security finding still
  // blocks DONE, to decide which zone the scan section belongs in. Read from
  // the same react-query key `SecurityScanSection` uses (one fetch); absent
  // data means "no blocking signal we know of", never a fabricated 0 finding.
  const { data: securityScans } = useSecurityScans(taskId)
  const securityBlocking = securityScans?.blocking.count ?? 0

  // Which ④ sub-sections are expanded. Collapsed by default; a deep link opens
  // its target. State, not derived, so a user's manual toggle sticks.
  const [expanded, setExpanded] = useState<Set<DossierSection>>(() =>
    targetSection ? new Set([targetSection]) : new Set()
  )

  // Deep link → expand the target sub-section and scroll it into view. Guarded
  // for jsdom (no layout) and re-run when the targeted section changes.
  useEffect(() => {
    if (!targetSection) return
    setExpanded(prev => {
      if (prev.has(targetSection)) return prev
      const next = new Set(prev)
      next.add(targetSection)
      return next
    })
    const el =
      typeof document !== 'undefined'
        ? document.getElementById(`dossier-${targetSection}`)
        : null
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [targetSection])

  const toggle = (section: DossierSection) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })

  const showEvidence = hasRuns || hasLineage || hasMemories

  // LUM-572: the evidence & causality sub-sections fold into AcceptanceTab's
  // Run report group (passed as evidenceSlot), so the whole after-the-fact
  // record — metrics + evidence — sits under one collapsible bucket. A legacy
  // deep link to an evidence sub-section opens that group on mount.
  const evidence = showEvidence ? (
    <div>
      <div className='mb-2 flex items-center gap-1 text-body-strong text-foreground'>
        {intl.formatMessage({
          id: 'dossier.evidence.title',
          defaultMessage: 'Evidence & causality',
        })}
        <InfoTooltip
          label={intl.formatMessage({
            id: 'dossier.evidence.tip',
            defaultMessage:
              'The supporting evidence behind the decision — agent runs, lineage causality and injected team memory. Collapsed by default; the decision and its verification lead.',
          })}
        />
      </div>
      <div className='space-y-2'>
        {hasRuns ? (
          <EvidenceSubSection
            section='runs'
            title={intl.formatMessage({
              id: 'dossier.section.runs',
              defaultMessage: 'Agent runs',
            })}
            summary={intl.formatMessage(
              {
                id: 'dossier.section.runsSummary',
                defaultMessage:
                  '{count, plural, one {# session} other {# sessions}}',
              },
              { count: runs.length }
            )}
            expanded={expanded.has('runs')}
            onToggle={() => toggle('runs')}
          >
            <AgentRunsSection
              taskId={taskId}
              taskStatus={taskStatus}
              agentStatus={agentStatus}
              runs={runs}
            />
          </EvidenceSubSection>
        ) : null}

        {hasLineage ? (
          <EvidenceSubSection
            section='lineage'
            title={intl.formatMessage({
              id: 'dossier.section.lineage',
              defaultMessage: 'Lineage causality',
            })}
            expanded={expanded.has('lineage')}
            onToggle={() => toggle('lineage')}
          >
            <LineageTab
              taskIdentifier={taskIdentifier}
              enabled={enabled && expanded.has('lineage')}
              showCost={false}
            />
          </EvidenceSubSection>
        ) : null}

        {hasMemories ? (
          <EvidenceSubSection
            section='memory'
            title={intl.formatMessage({
              id: 'dossier.section.memory',
              defaultMessage: 'Injected team memory',
            })}
            expanded={expanded.has('memory')}
            onToggle={() => toggle('memory')}
          >
            <MemoryTab
              scope='task'
              parentId={taskId}
              enabled={enabled && expanded.has('memory')}
              memberNames={memberNames}
            />
          </EvidenceSubSection>
        ) : null}
      </div>
    </div>
  ) : null

  return (
    <AcceptanceTab
      taskIdentifier={taskIdentifier}
      enabled={enabled}
      workspaceUrl={workspaceUrl}
      members={members}
      agentActors={agentActors}
      onVerdictRecorded={onVerdictRecorded}
      latestRunSummary={latestRunSummary}
      {...(mentionSources ? { mentionSources } : {})}
      evidenceSlot={evidence}
      gatesSlot={<DeliveryGatesSection taskId={taskId} />}
      securitySlot={<SecurityScanSection taskId={taskId} />}
      securityBlocking={securityBlocking}
      reportInitiallyOpen={targetSection != null}
    />
  )
}
