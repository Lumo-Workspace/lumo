/** @jest-environment jsdom */
/**
 * LUM-572 → LUM-1009 — the dossier's evidence (Agent runs / Lineage causality /
 * Injected team memory) and the security scan report are flat rows in the
 * Record tab's Records section: one fold level, collapsed by default, no
 * "Run report" group or "Evidence & causality" heading around them. A legacy
 * deep link still expands its targeted row. Renders the REAL RecordTab.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      const en = require('@/lib/i18n/en.json') as Record<string, string>
      let msg = en[id] ?? defaultMessage ?? id
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
  useSecurityScans: jest.fn(() => ({
    data: undefined,
    isLoading: false,
    isError: false,
  })),
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
    dispositionBoundaryCrossing: jest.fn().mockResolvedValue({}),
    spawnBoundaryRemediation: jest.fn().mockResolvedValue({}),
  },
}))

// Stub the heavy leaf bodies; the structure under test is composition, not their
// internals.
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
import { useSecurityScans } from '@/app/workspace/[workspaceUrl]/hooks/useSecurityScans'

const mockAgentRuns = useAgentRuns as jest.Mock
const mockStatus = useTaskStatus as jest.Mock
const mockSecurity = useSecurityScans as jest.Mock

const baseProps: any = {
  taskId: 'task-1',
  taskIdentifier: 'LUM-1',
  taskStatus: 'IN_REVIEW',
  agentStatus: null,
  workspaceUrl: 'acme',
  members: [],
  agentActors: [],
  enabled: true,
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
      version: 2,
      task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'IN_REVIEW' },
      cost: { tokenCost: 1000, activeTimeSec: 10 },
      struggleTrail: { pullRequests: [], reopens: [] },
      trend: {
        cost: [],
        rework: { reopens: 0, extraPrCycles: 0, total: 0 },
      },
    },
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
})

describe('evidence and security are flat Records rows', () => {
  it('each evidence row sits in Records, collapsed, with no wrapping group', () => {
    render(<TaskDossier {...baseProps} />)

    expect(screen.queryByRole('button', { name: /Run report/i })).toBeNull()
    expect(screen.queryByText('Evidence & causality')).toBeNull()
    const records = screen.getByTestId('record-records')
    for (const name of [
      /Agent runs/,
      /Lineage causality/,
      /Injected team memory/,
    ]) {
      const toggle = screen.getByRole('button', { name })
      expect(records).toContainElement(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    }
    expect(screen.queryByTestId('runs-body')).toBeNull()
    expect(screen.queryByTestId('lineage-body')).toBeNull()
    expect(screen.queryByTestId('memory-body')).toBeNull()

    // One click opens a row's body; the row's collapsed summary gives way.
    const runs = screen.getByRole('button', { name: /Agent runs/ })
    expect(runs).toHaveTextContent('1 session')
    fireEvent.click(runs)
    expect(screen.getByTestId('runs-body')).toBeInTheDocument()
    expect(runs).not.toHaveTextContent('1 session')
  })

  it('a legacy deep link expands its target row', () => {
    render(<TaskDossier {...baseProps} targetSection='lineage' />)
    expect(
      screen.getByRole('button', { name: /Lineage causality/ })
    ).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('lineage-body')).toBeInTheDocument()
    expect(document.getElementById('dossier-lineage')).not.toBeNull()
  })

  it('a task with a scanned PR gets a collapsed Security scan row in Records, summarised', () => {
    mockSecurity.mockReturnValue({
      data: {
        prs: [
          {
            pr: { id: 'pr1', number: 7, title: 'x', url: 'https://x/7' },
            latest: {
              id: 's1',
              status: 'CLEAN',
              complete: true,
              findings: [],
              stages: {},
              headSha: 'abcdef0123',
            },
          },
        ],
        blocking: { count: 0 },
        suggested: { count: 0 },
        scanningOff: false,
      },
      isLoading: false,
      isError: false,
    })
    render(<TaskDossier {...baseProps} />)

    const row = screen.getByRole('button', { name: /Security scan/ })
    expect(screen.getByTestId('record-records')).toContainElement(row)
    expect(row).toHaveAttribute('aria-expanded', 'false')
    // The same rollup line the scan panel prints (formatSecuritySummaryLine).
    expect(row).toHaveTextContent('1 PR')
    expect(screen.queryByTestId('record-needs-action')).toBeNull()
  })
})
