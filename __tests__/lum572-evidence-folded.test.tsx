/** @jest-environment jsdom */
/**
 * LUM-572 → LUM-1009 — the dossier's evidence (Agent runs / Context fed to agents /
 * Injected team memory) are flat rows in the Record tab's Records section: one
 * fold level, collapsed by default, no "Run report" group or "Evidence &
 * causality" heading around them. A legacy deep link still expands its
 * targeted row. Renders the REAL RecordTab, without the security plugin; the
 * Security scan row lives in __tests__/ee/security/lum572-evidence-folded.test.tsx.
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
// LUM-1064: core test, run without the security plugin (the OSS build).
jest.mock('@/lib/plugins/installed.client', () => ({
  INSTALLED_CLIENT_PLUGINS: [],
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
import { render, screen, fireEvent, act } from '@testing-library/react'
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
      /Context fed to agents/,
      /Injected team memory/,
    ]) {
      const toggle = screen.getByRole('button', { name })
      expect(records).toContainElement(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    }
    expect(screen.queryByTestId('runs-body')).toBeNull()
    expect(screen.queryByTestId('lineage-body')).toBeNull()
    expect(screen.queryByTestId('memory-body')).toBeNull()

    // One click opens a row's body; LUM-1012: the verdict stays put.
    const runs = screen.getByRole('button', { name: /Agent runs/ })
    expect(runs).toHaveTextContent('1 session')
    fireEvent.click(runs)
    expect(screen.getByTestId('runs-body')).toBeInTheDocument()
    expect(runs).toHaveTextContent('1 session')
  })

  it('a legacy deep link expands its target row', () => {
    render(<TaskDossier {...baseProps} targetSection='lineage' />)
    expect(
      screen.getByRole('button', { name: /Context fed to agents/ })
    ).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('lineage-body')).toBeInTheDocument()
    expect(document.getElementById('dossier-lineage')).not.toBeNull()
  })
})

// LUM-1012: Test cases is no longer a section of its own — it is the first
// Records row, folded like the rest, and opens itself for a run link.
describe('test cases are the first Records row', () => {
  afterEach(() => {
    window.location.hash = ''
  })

  it('sits first in Records, collapsed, with a verdict', () => {
    render(<TaskDossier {...baseProps} />)
    const records = screen.getByTestId('record-records')
    const row = screen.getByRole('button', { name: /Test cases/ })
    expect(records).toContainElement(row)
    expect(records.querySelector('button')).toBe(row)
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(row).toHaveTextContent('None yet')
    expect(document.getElementById('dossier-tests')).toContainElement(row)
    expect(screen.queryByTestId('record-tests')).toBeNull()
  })

  it('opens itself when the page lands on a run link', () => {
    window.location.hash = '#run-abc'
    render(<TaskDossier {...baseProps} />)
    expect(screen.getByRole('button', { name: /Test cases/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('opens itself when a Needs action defect row changes the hash', () => {
    render(<TaskDossier {...baseProps} />)
    const row = screen.getByRole('button', { name: /Test cases/ })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    act(() => {
      window.location.hash = '#run-xyz'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(row).toHaveAttribute('aria-expanded', 'true')
  })

  it('a legacy /tests link (targetSection tests) opens it', () => {
    render(<TaskDossier {...baseProps} targetSection='tests' />)
    expect(screen.getByRole('button', { name: /Test cases/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })
})
