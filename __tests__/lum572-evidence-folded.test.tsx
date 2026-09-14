/** @jest-environment jsdom */
/**
 * LUM-572 (follow-up) — the dossier's evidence sub-sections (Agent runs /
 * Lineage causality / Injected team memory) fold INTO the single collapsible
 * "Run report" group rather than sitting as a separate top-level "Evidence &
 * causality" region. So the whole after-the-fact record (metrics + evidence)
 * lives under one bucket, collapsed by default; a legacy deep link still expands
 * the group and its targeted sub-section.
 *
 * This supersedes LUM-567's separate ④ region (lum567-task-dossier.test.tsx is
 * updated in lockstep). Renders the REAL AcceptanceTab so the group's collapse
 * genuinely gates the evidence slot.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      let msg = defaultMessage ?? id
      msg = msg.replace(
        /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
        (_m, key, one, other) => {
          const n = Number(values?.[key] ?? 0)
          return (n === 1 ? one : other).replace('#', String(n))
        }
      )
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.split(`{${k}}`).join(String(v))
      }
      return msg
    },
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useAgentRuns', () => ({
  useAgentRuns: jest.fn(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskStatus', () => ({
  useTaskStatus: jest.fn(),
}))
// LUM-732 review I3 promoted the security panel out of the audit fold, so it
// now mounts with the dossier and would reach for a QueryClient this test has
// no provider for. Its own behaviour is covered by SecurityScanSection.test.
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSecurityScans', () => ({
  useSecurityScans: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
  }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings', () => ({
  useBoundaryCrossings: jest.fn(() => ({
    crossings: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
  })),
}))
jest.mock('@/lib/api-client', () => ({
  tasksClient: {
    submitHumanVerdict: jest.fn().mockResolvedValue({}),
    dispositionBoundaryCrossing: jest.fn().mockResolvedValue({}),
    spawnBoundaryRemediation: jest.fn().mockResolvedValue({}),
  },
}))

// Stub the heavy leaf bodies; the structure under test is composition, not their
// internals.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/VerdictDecision',
  () => ({ VerdictDecision: () => <div data-testid='verdict-status' /> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AgentRunsSection',
  () => ({ AgentRunsSection: () => <div data-testid='runs-body' /> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/LineageTab',
  () => ({ LineageTab: () => <div data-testid='lineage-body' /> })
)
jest.mock('@/app/workspace/[workspaceUrl]/components/memory/MemoryTab', () => ({
  MemoryTab: () => <div data-testid='memory-body' />,
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskDossier } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TaskDossier'
import { useAgentRuns } from '@/app/workspace/[workspaceUrl]/hooks/useAgentRuns'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'

const mockAgentRuns = useAgentRuns as jest.Mock
const mockStatus = useTaskStatus as jest.Mock

const baseProps: any = {
  taskId: 'task-1',
  taskIdentifier: 'LUM-1',
  taskStatus: 'IN_REVIEW',
  agentStatus: null,
  workspaceUrl: 'acme',
  members: [],
  agentActors: [],
  enabled: true,
  onVerdictRecorded: jest.fn(),
  memberNames: new Map(),
  hasLineage: true,
  hasMemories: true,
  targetSection: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAgentRuns.mockReturnValue({
    data: { runs: [{ runSummary: 'did things', items: [] }] },
    loading: false,
    error: null,
  })
  mockStatus.mockReturnValue({
    data: {
      version: 1,
      task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'IN_REVIEW' },
      currentRound: 2,
      maxRounds: 3,
      escalated: false,
      criteria: [
        {
          id: 'm1',
          statement: 'route returns 409 on lock',
          verifierType: 'MACHINE',
          checkpointer: 'npx jest x',
          evidenceRequired: false,
          judgeSteps: null,
          source: 'AGENT_DRAFT',
          addedAtRound: 0,
          latestVerdict: {
            round: 1,
            verdict: 'PASS',
            verifierType: 'MACHINE',
            evidencePointer: 'cmd:npx jest x#exit=0',
            rejectionReason: null,
            rejectionReasonEnum: null,
            recordedAt: '2026-06-10T10:00:00.000Z',
          },
          machinePassed: true,
          verdictStale: false,
          checkMismatch: false,
          changeState: null,
          changedAtRound: null,
          lastEdit: null,
        },
      ],
      machineVerification: { total: 1, machineVerified: 1, humanOverridden: 0 },
      cost: { tokenCost: 1000, activeTimeSec: 10, reworkRounds: 0 },
      struggleTrail: {
        reworkRounds: [],
        sendBacks: [],
        followUps: [],
        pullRequests: [],
        reopens: [],
      },
      trend: {
        passRate: [],
        cost: [],
        rework: { reworkRounds: 0, reopens: 0, extraPrCycles: 0, total: 0 },
      },
      claim: { text: null, source: null },
      removedCriteria: [],
      verificationHistory: [],
      lastRoundFailures: [],
      nextActions: [],
    },
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
})

describe('evidence folded into the run report group', () => {
  it('evidence sub-sections live inside the run report group, each collapsed', () => {
    render(<TaskDossier {...baseProps} />)

    // LUM-496: the Run report group itself now opens by default (its KPI tiles
    // are the summary), so the three evidence sub-sections are reachable at its
    // tail — each still collapsed, and with no separate evidence region of
    // their own anywhere else on the surface.
    const runReport = screen.getByRole('button', { name: /Run report/i })
    expect(runReport).toHaveAttribute('aria-expanded', 'true')
    for (const name of [
      /Agent runs/,
      /Lineage causality/,
      /Injected team memory/,
    ]) {
      const toggle = screen.getByRole('button', { name })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    }
    expect(screen.queryByTestId('lineage-body')).toBeNull()
    expect(screen.queryByTestId('memory-body')).toBeNull()

    // Collapsing the group takes the whole after-the-fact record — evidence
    // sub-sections included — out of the DOM.
    fireEvent.click(runReport)
    expect(screen.queryByRole('button', { name: /Agent runs/ })).toBeNull()
    expect(
      screen.queryByRole('button', { name: /Lineage causality/ })
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: /Injected team memory/ })
    ).toBeNull()
  })

  it('a legacy deep link expands the run report group and its target sub-section', () => {
    render(<TaskDossier {...baseProps} targetSection='lineage' />)

    // The group auto-opens (so the deep-linked evidence is reachable) and the
    // targeted sub-section is expanded with its body mounted.
    expect(
      screen.getByRole('button', { name: /Lineage causality/ })
    ).toBeInTheDocument()
    expect(screen.getByTestId('lineage-body')).toBeInTheDocument()
  })
})
