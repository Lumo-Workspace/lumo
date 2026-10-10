/** @jest-environment jsdom */
/**
 * LUM-572 → LUM-1009 — the security scan report (security plugin) is a flat
 * row in the Record tab's Records section, collapsed by default, like the
 * evidence rows. Renders the REAL RecordTab with the plugin installed.
 * LUM-1064: split from __tests__/lum572-evidence-folded.test.tsx (core half).
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
// LUM-1011: the dossier reads test cases (Done gate row + Test cases section).
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTestCases', () => ({
  useTestCases: jest.fn(() => ({
    testCases: [],
    pullRequests: [],
    loading: false,
    error: null,
    add: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    recordRun: jest.fn(),
    disposeDefect: jest.fn(),
  })),
}))
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
import { render, screen } from '@testing-library/react'
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

describe('the security scan is a flat Records row', () => {
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
    // LUM-1012: the row's verdict (formatSecurityVerdict).
    expect(row).toHaveTextContent('Clean')
    expect(screen.queryByTestId('record-needs-action')).toBeNull()
  })
})
