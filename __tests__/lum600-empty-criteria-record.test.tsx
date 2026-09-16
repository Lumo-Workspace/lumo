/** @jest-environment jsdom */
/**
 * LUM-600: when a task has no acceptance criteria, the RECORD tab must collapse
 * ONLY the contract block (criteria zones + contract-derived verdict status) and
 * keep rendering every contract-independent section — boundary crossings, the Run
 * report (cost / struggle / trend) and the Evidence & causality slot (agent runs
 * / lineage / memory). The previous early-return short-circuited the whole
 * dossier to just the boundary panel + empty note, so "看不到运行了".
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

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskStatus', () => ({
  useTaskStatus: jest.fn(),
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

// The contract-derived verdict surface — stub it so its presence/absence is a
// clean proxy for "is the contract block rendered". The stub only mounts when
// AcceptanceTab chooses to render <VerdictDecision>.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/VerdictDecision',
  () => ({
    VerdictDecision: () => <div data-testid='verdict-status' />,
  })
)

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BoundaryCrossingsPanel',
  () => ({
    BoundaryCrossingsPanel: () => <div id='boundary-crossings' />,
  })
)

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { AcceptanceTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AcceptanceTab'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
} from '@/app/workspace/[workspaceUrl]/types'

const mockStatus = useTaskStatus as jest.Mock

function statusView(
  over: Partial<TaskAcceptanceStatusView> = {}
): TaskAcceptanceStatusView {
  return {
    version: 1,
    task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'IN_PROGRESS' },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria: [],
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    ...over,
  }
}

function machinePass(
  over: Partial<TaskStatusCriterionView> = {}
): TaskStatusCriterionView {
  return {
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
      evidencePointer: 'cmd:jest#exit=0',
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
    confirmedAt: null,
    ...over,
  }
}

function set(data: TaskAcceptanceStatusView) {
  mockStatus.mockReturnValue({
    data,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
}

function render_(over: Partial<TaskAcceptanceStatusView> = {}) {
  set(statusView(over))
  return render(
    <AcceptanceTab
      taskIdentifier='LUM-1'
      enabled={true}
      onVerdictRecorded={jest.fn()}
      evidenceSlot={<div data-testid='evidence-slot' />}
      reportInitiallyOpen={true}
    />
  )
}

beforeEach(() => jest.clearAllMocks())

describe('LUM-600 empty-criteria record tab', () => {
  it('renders evidence and run report when criteria are empty', () => {
    render_({ criteria: [] })
    // The contract-independent evidence slot is no longer short-circuited away…
    expect(screen.getByTestId('evidence-slot')).toBeInTheDocument()
    // …and the Run report group shell still renders.
    expect(screen.getByText('Run report')).toBeInTheDocument()
    // The empty-contract note still stands in for the missing contract.
    expect(screen.getByText('此任务暂无验收标准')).toBeInTheDocument()
  })

  it('hides the contract block when criteria are empty', () => {
    render_({ criteria: [] })
    expect(screen.getByText('此任务暂无验收标准')).toBeInTheDocument()
    // Contract-derived verdict surface is not rendered…
    expect(screen.queryByTestId('verdict-status')).not.toBeInTheDocument()
    // …and the criteria zones (LUM-620: "Machine-verified" / "Needs your
    // judgment") are absent when there is no contract.
    expect(screen.queryByText('Machine-verified')).not.toBeInTheDocument()
    expect(screen.queryByText('Needs your judgment')).not.toBeInTheDocument()
  })

  it('keeps the full contract block when criteria are present', () => {
    render_({ criteria: [machinePass()] })
    // Contract block still renders in full: verdict surface + criteria group
    // (LUM-620: the machine criterion surfaces the "Machine-verified" zone)…
    expect(screen.getByTestId('verdict-status')).toBeInTheDocument()
    expect(screen.getByText('Machine-verified')).toBeInTheDocument()
    // …alongside the always-on evidence slot (no regression).
    expect(screen.getByTestId('evidence-slot')).toBeInTheDocument()
    // And the empty note must NOT appear when a contract exists.
    expect(screen.queryByText('此任务暂无验收标准')).not.toBeInTheDocument()
  })
})
