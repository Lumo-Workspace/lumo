/** @jest-environment jsdom */
/**
 * LUM-457: the Acceptance tab downgrades a PASS that vouches for a pre-edit
 * version of the criterion (verdictStale / checkMismatch) — a distinct marker
 * plus a re-run hint — and disambiguates the "not yet run" copy so a PASS badge
 * never sits next to a bare "not yet run".
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      let msg = defaultMessage ?? id
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

// LUM-467: the tab leads with the shared header VerdictDecision — stub it so this
// stale-verdict render suite isn't coupled to its subtree.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/VerdictDecision',
  () => ({
    VerdictDecision: () => <div data-testid='verdict-status' />,
  })
)

import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { AcceptanceTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AcceptanceTab'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
} from '@/app/workspace/[workspaceUrl]/types'

const mockStatus = useTaskStatus as jest.Mock

function criterion(
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
    confirmedAt: null,
    ...over,
  }
}

function set(
  criteria: TaskStatusCriterionView[],
  over: Partial<TaskAcceptanceStatusView> = {}
) {
  const data: TaskAcceptanceStatusView = {
    version: 1,
    task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'IN_PROGRESS' },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria,
    machineVerification: {
      total: criteria.filter(c => c.verifierType === 'MACHINE').length,
      machineVerified: 0,
      humanOverridden: 0,
    },
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    ...over,
  }
  mockStatus.mockReturnValue({
    data,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
}

// When every machine criterion passes the zone collapses (LUM-451) — expand it
// so the passing rows render.
function expandMachine() {
  const btn = screen.queryByRole('button', { name: /Machine-verified/i })
  // Click only when collapsed — the zone auto-expands when a row isn't a
  // genuine machine pass, and a second click would re-collapse it.
  if (btn && btn.getAttribute('aria-expanded') === 'false') fireEvent.click(btn)
}

beforeEach(() => jest.clearAllMocks())

it('downgrades a stale PASS with a pre-edit-version marker and a re-run hint', () => {
  set([criterion({ verdictStale: true })])
  render(
    <AcceptanceTab
      taskIdentifier='LUM-1'
      enabled={true}
      onVerdictRecorded={jest.fn()}
    />
  )
  expandMachine()

  expect(screen.getByTestId('stale-marker')).toHaveTextContent(
    /pre-edit version/i
  )
  expect(screen.getByText(/re-run lumo verify/i)).toBeInTheDocument()
})

it('downgrades a checkpointer-mismatch PASS the same way', () => {
  set([criterion({ checkMismatch: true })])
  render(
    <AcceptanceTab
      taskIdentifier='LUM-1'
      enabled={true}
      onVerdictRecorded={jest.fn()}
    />
  )
  expandMachine()

  expect(screen.getByTestId('stale-marker')).toBeInTheDocument()
})

it('leaves a genuinely fresh PASS unmarked', () => {
  set([criterion()])
  render(
    <AcceptanceTab
      taskIdentifier='LUM-1'
      enabled={true}
      onVerdictRecorded={jest.fn()}
    />
  )
  expandMachine()

  expect(screen.queryByTestId('stale-marker')).not.toBeInTheDocument()
})

it('disambiguates an override PASS from a never-run check (no bare "not yet run" beside a PASS)', () => {
  // A MACHINE criterion passing only via a human override: latest verdict is a
  // PASS with no machine evidence pointer.
  set([
    criterion({
      machinePassed: false,
      latestVerdict: {
        round: 1,
        verdict: 'PASS',
        verifierType: 'HUMAN',
        evidencePointer: null,
        rejectionReason: null,
        rejectionReasonEnum: null,
        recordedAt: '2026-06-10T10:00:00.000Z',
      },
    }),
  ])
  render(
    <AcceptanceTab
      taskIdentifier='LUM-1'
      enabled={true}
      onVerdictRecorded={jest.fn()}
    />
  )
  expandMachine()
  // Open the check-output disclosure. LUM-496: a human override is not a
  // machine pass, so this row now sits in the NEEDS ACTION card where the same
  // disclosure is labelled "View output".
  fireEvent.click(screen.getByRole('button', { name: /view output/i }))

  expect(screen.getByText(/passed by human override/i)).toBeInTheDocument()
  expect(
    screen.queryByText(/^Machine check not yet run$/)
  ).not.toBeInTheDocument()
})
