'use client'

import { anyRunOverstated } from '@/lib/agent-run/usage-dedupe-cutoff'
import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import type { TaskDetail, WorkspaceMemberInfo } from '../../types'
import { TEST_CASES_ANCHOR, type DossierSection } from './taskTabs'
import { useAgentRuns } from '../../hooks/useAgentRuns'
import { summarizeRunAttributions } from '@/lib/attribution/run-attribution'
import { RecordTab } from './RecordTab'
import { AgentRunsSection } from './AgentRunsSection'
import { RecordRow } from './RecordRow'
import { LineageTab } from './LineageTab'
import { TestCasesSection } from './TestCasesSection'
import { BlockingTestDefects } from './BlockingTestDefects'
import { useTestCases } from '../../hooks/useTestCases'
import { summarizeTestCases } from '@/lib/test-cases/case-summary'
import { MemoryTab } from '../memory/MemoryTab'
import { PluginTaskDossier } from '@/lib/plugins/client'

/** The Records rows TaskDossier owns: test cases, the evidence sections,
 *  and one per plugin (LUM-1062: `plugin:<id>`, e.g. the security scan).
 *  `tests` is itself a DossierSection (legacy `/tests` links). */
type RecordRowKey = DossierSection | `plugin:${string}`

/** A hash that lands inside the Test cases row: a run (`#run-<id>`, from the
 *  Needs action defect rows or an old Tests-tab link) or the row itself. */
function hashTargetsTests(hash: string): boolean {
  return hash.startsWith('#run-') || hash === `#${TEST_CASES_ANCHOR}`
}

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
 * test cases (LUM-1012), the plugin rows (LUM-1062: the security scan report,
 * through the `task.dossier` slot) and the evidence rows (agent
 * runs, lineage, injected memory) — and keeps them deep-linkable: an old Delivery / Lineage /
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

  // LUM-1011: test cases feed the Done gate's row and the Needs action queue.
  // Same react-query key the section and the defect queue read (one fetch).
  const { testCases } = useTestCases({ kind: 'task', id: taskId }, enabled)
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

  // LUM-1012: Test cases is a folded row now, so a run link must open it
  // before the section (mounted only while open) can scroll onto the run.
  // Read in an effect — the hash is not known during render — and on
  // hashchange, since the Needs action defect rows only change the hash.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const open = () => {
      if (!hashTargetsTests(window.location.hash)) return
      setExpanded(prev =>
        prev.has('tests') ? prev : new Set(prev).add('tests')
      )
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [])

  const toggle = (section: RecordRowKey) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })

  // LUM-1012: Test cases as the first Records row — always drawn (it is
  // where a case gets added), verdict "3/4 passing" or "none yet".
  const testCasesRecord = (
    <RecordRow
      id={TEST_CASES_ANCHOR}
      title={intl.formatMessage({ id: 'testCases.section.title' })}
      summary={
        testsSummary.total === 0
          ? intl.formatMessage({ id: 'record.tests.none' })
          : intl.formatMessage(
              { id: 'record.tests.passing' },
              { passing: testsSummary.passing, total: testsSummary.total }
            )
      }
      expanded={expanded.has('tests')}
      onToggle={() => toggle('tests')}
    >
      <TestCasesSection
        owner={{ kind: 'task', id: taskId }}
        handlePrefix={taskIdentifier}
        enabled={enabled}
        members={members}
      />
    </RecordRow>
  )

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
            defaultMessage: 'Context fed to agents',
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

  // LUM-1062: plugins (the security scan) add their Done gate signal, Needs
  // action items and Records row through the `task.dossier` slot. Without a
  // plugin the gate shows no such row and nothing else is added.
  return (
    <PluginTaskDossier
      taskId={taskId}
      isExpanded={id => expanded.has(`plugin:${id}`)}
      onToggle={id => toggle(`plugin:${id}`)}
    >
      {plugins => (
        <RecordTab
          taskIdentifier={taskIdentifier}
          enabled={enabled}
          workspaceUrl={workspaceUrl}
          members={members}
          agentActors={agentActors}
          showSecurityGate={plugins.present}
          securityBlocking={plugins.blocking}
          securityScanned={plugins.checked}
          blockingSecuritySlot={plugins.needsAction}
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
          testCasesSlot={testCasesRecord}
          securityRecordSlot={plugins.records}
          evidenceSlot={evidence}
          attribution={attributionSummary}
          costApproximate={attributionSummary.approximate}
          costPreDedupe={preDedupe}
        />
      )}
    </PluginTaskDossier>
  )
}
