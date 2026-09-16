/** @jest-environment jsdom */
/**
 * LUM-611: when a MACHINE criterion was machine-verified (a checkpointer round
 * PASSed with cmd: evidence) and a human later signed off with a PASS (pushing
 * `latestVerdict` to HUMAN with no evidence pointer), the acceptance tab must
 * still disclose the machine round's evidence and a "machine-verified @rN"
 * marker — NOT "No machine check ran — passed by human override" nor "Evidence
 * pending". A human override does not erase the independent machine evidence.
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

// A MACHINE criterion machine-verified at round 1, then signed off by a human
// PASS (the latest verdict, with no evidence pointer).
function overriddenMachineCriterion(): TaskStatusCriterionView {
  return {
    id: 'm1',
    statement: 'route returns 409 on lock',
    verifierType: 'MACHINE',
    checkpointer: 'npx jest lock.test.ts',
    evidenceRequired: true,
    judgeSteps: null,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    latestVerdict: {
      round: 1,
      verdict: 'PASS',
      verifierType: 'HUMAN',
      evidencePointer: null,
      rejectionReason: null,
      rejectionReasonEnum: null,
      recordedAt: '2026-06-10T11:00:00.000Z',
    },
    machineVerdict: {
      round: 1,
      verdict: 'PASS',
      verifierType: 'MACHINE',
      evidencePointer: 'cmd:npx jest lock.test.ts#exit=0',
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
  }
}

function set(criteria: TaskStatusCriterionView[]) {
  const data: TaskAcceptanceStatusView = {
    version: 1,
    task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'DONE' },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria,
    machineVerification: {
      total: criteria.filter(c => c.verifierType === 'MACHINE').length,
      machineVerified: criteria.length,
      humanOverridden: 0,
    },
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
  }
  mockStatus.mockReturnValue({
    data,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
}

// All machine criteria pass → the zone collapses (LUM-451); expand it so the row
// renders.
function expandMachine() {
  const btn = screen.queryByRole('button', { name: /Machine-verified/i })
  if (btn && btn.getAttribute('aria-expanded') === 'false') fireEvent.click(btn)
}

beforeEach(() => jest.clearAllMocks())

it('acceptance tab shows machine cmd evidence not human override after a human signs off a machine pass LUM611', () => {
  set([overriddenMachineCriterion()])
  render(
    <AcceptanceTab
      taskIdentifier='LUM-1'
      enabled={true}
      onVerdictRecorded={jest.fn()}
    />
  )
  expandMachine()
  fireEvent.click(screen.getByRole('button', { name: /view check output/i }))

  // The machine round's evidence is disclosed, with a machine-verified marker
  // naming the round it ran.
  expect(screen.getByTestId('machine-verified-marker')).toHaveTextContent(
    /machine-verified · round 1/i
  )
  expect(screen.getByText(/exit code 0/i)).toBeInTheDocument()

  // …and the misleading override / pending copy is gone.
  expect(
    screen.queryByText(/passed by human override/i)
  ).not.toBeInTheDocument()
  expect(screen.queryByText(/Evidence pending/i)).not.toBeInTheDocument()
})
