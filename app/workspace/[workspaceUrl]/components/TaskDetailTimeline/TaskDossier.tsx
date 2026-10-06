'use client'

import { anyRunOverstated } from '@/lib/agent-run/usage-dedupe-cutoff'
import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import type { TaskDetail, WorkspaceMemberInfo } from '../../types'
import type { DossierSection } from './taskTabs'
import { useAgentRuns } from '../../hooks/useAgentRuns'
import { useSecurityScans } from '../../hooks/useSecurityScans'
import { summarizeRunAttributions } from '@/lib/attribution/run-attribution'
import { RecordTab } from './RecordTab'
import { AgentRunsSection } from './AgentRunsSection'
import {
  BlockingSecurityFindings,
  SecurityScanSection,
} from './SecurityScanSection'
import { RecordRow } from './RecordRow'
import { formatSecuritySummaryLine } from './security-summary-line'
import { LineageTab } from './LineageTab'
import { TestCasesSection } from './TestCasesSection'
import { BlockingTestDefects } from './BlockingTestDefects'
import { useTestCases } from '../../hooks/useTestCases'
import { summarizeTestCases } from '@/lib/test-cases/case-summary'
import { MemoryTab } from '../memory/MemoryTab'

/** The Records rows TaskDossier owns: the evidence sections + security. */
type RecordRowKey = DossierSection | 'security'

interface TaskDossierProps {
  taskId: string
  taskIdentifier: string
  taskStatus: TaskDetail['status']
  agentStatus?: string | null | undefined
  workspaceUrl: string
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string }[]
  enabled: boolean
  /** WorkspaceMember.id → name, for the memory row's "Added by X". */
  memberNames: Map<string, string>
  /** Presence of the Lineage / Memory rows — an empty row is
   *  not drawn (the runs row gates itself on runs presence). */
  hasLineage: boolean
  hasMemories: boolean
  /** A legacy deep link (delivery/lineage/memory) targets a Records row to
   *  expand + scroll to; null when landing on the dossier directly. */
  targetSection: DossierSection | null
}

/**
 * The decision-first task dossier (LUM-567): one surface that replaces the
 * former Delivery / Memory / Lineage tabs. Reads top-down as decision → why.
 *
 * The whole surface is {@link RecordTab} (LUM-1009: Done gate → Needs action →
 * Run overview → Records). This component builds the Records rows it owns —
 * the security scan report and the evidence rows (agent runs, lineage,
 * injected memory) — and keeps them deep-linkable: an old Delivery / Lineage /
 * Memory URL expands its target row and scrolls to it (LUM-458). Run sessions
 * are fetched once here (single source) and shared with the Sessions tile and
 * the runs row.
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
  memberNames,
  hasLineage,
  hasMemories,
  targetSection,
}: TaskDossierProps) {
  const intl = useIntl()
  const { data: runsData } = useAgentRuns({ taskId, enabled })
  const runs = runsData?.runs ?? []

  const hasRuns = runs.length > 0
  const preDedupe = anyRunOverstated(runs)
  const attributionSummary = summarizeRunAttributions(
    runs.map(r => r.attribution)
  )

  // LUM-496: the record tab needs to know whether a security finding still
  // blocks DONE, to decide which zone the scan section belongs in. Read from
  // the same react-query key `SecurityScanSection` uses (one fetch); absent
  // data means "no blocking signal we know of", never a fabricated 0 finding.
  const { data: securityScans, isError: securityError } =
    useSecurityScans(taskId)
  const securityBlocking = securityScans?.blocking.count ?? 0
  const securityScanned = (securityScans?.prs ?? []).some(
    p => p.latest !== null
  )
  // LUM-1009: the Records row for the security scan. Shown whenever the task
  // has a PR (or the read failed — said out loud inside, review I4).
  const showSecurityRecord =
    securityError || (securityScans?.prs.length ?? 0) > 0

  // LUM-1011: test cases feed the Done gate's row and the Needs action queue.
  // Same react-query key the section and the defect queue read (one fetch).
  const { testCases } = useTestCases(taskId, enabled)
  const testsSummary = summarizeTestCases(testCases)

  // Which Records rows are expanded. Collapsed by default; a deep link opens
  // its target. State, not derived, so a user's manual toggle sticks.
  const [expanded, setExpanded] = useState<Set<RecordRowKey>>(() =>
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
    // A `#run-<id>` hash (old Tests-tab run link) is scrolled by the Test cases
    // section itself, onto the run — don't fight it with a section scroll.
    if (
      typeof window !== 'undefined' &&
      window.location.hash.startsWith('#run-')
    )
      return
    const el =
      typeof document !== 'undefined'
        ? document.getElementById(`dossier-${targetSection}`)
        : null
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [targetSection])

  const toggle = (section: RecordRowKey) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })

  // LUM-1009: the full scan report as a Records row — never moves, whether or
  // not a finding blocks (blocking findings also come up in Needs action).
  const securityRecord = showSecurityRecord ? (
    <RecordRow
      id='dossier-security'
      title={intl.formatMessage({ id: 'securityScan.section.title' })}
      {...(securityScans
        ? { summary: formatSecuritySummaryLine(intl, securityScans) }
        : {})}
      expanded={expanded.has('security')}
      onToggle={() => toggle('security')}
    >
      <SecurityScanSection taskId={taskId} />
    </RecordRow>
  ) : null

  // LUM-572/1009: agent runs, lineage and injected memory — flat Records
  // rows, one fold level. A legacy deep link expands its target row.
  const evidence = (
    <>
      {hasRuns ? (
        <RecordRow
          id='dossier-runs'
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
        </RecordRow>
      ) : null}

      {hasLineage ? (
        <RecordRow
          id='dossier-lineage'
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
        </RecordRow>
      ) : null}

      {hasMemories ? (
        <RecordRow
          id='dossier-memory'
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
        </RecordRow>
      ) : null}
    </>
  )

  return (
    <RecordTab
      taskIdentifier={taskIdentifier}
      enabled={enabled}
      workspaceUrl={workspaceUrl}
      members={members}
      agentActors={agentActors}
      securityBlocking={securityBlocking}
      securityScanned={securityScanned}
      blockingSecuritySlot={<BlockingSecurityFindings taskId={taskId} />}
      testsBlocking={testsSummary.blocking.length}
      testsSummary={{
        total: testsSummary.total,
        passing: testsSummary.passing,
      }}
      blockingTestsSlot={
        <BlockingTestDefects
          taskId={taskId}
          taskIdentifier={taskIdentifier}
          enabled={enabled}
        />
      }
      testCasesSlot={
        <TestCasesSection
          taskId={taskId}
          taskIdentifier={taskIdentifier}
          enabled={enabled}
        />
      }
      securityRecordSlot={securityRecord}
      evidenceSlot={evidence}
      attribution={attributionSummary}
      costApproximate={attributionSummary.approximate}
      costPreDedupe={preDedupe}
    />
  )
}
