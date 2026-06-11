/** @jest-environment jsdom */
/**
 * LUM-423: the read-only Acceptance tab leads with RESULTS — a verdict banner,
 * a verification-record (round history) section, and per-criterion result rows
 * (prominent verdict badge; the raw check command + evidence tucked behind a
 * "view check output" disclosure). Consumes the LUM-344 status read model;
 * no new backend.
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

// LUM-426: AcceptanceTab now hosts the boundary-crossings panel. Isolate it the
// same way as useTaskStatus — default to "no open crossings" so the panel
// renders null and these tests stay focused on the verdict/contract UI.
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

import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AcceptanceTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AcceptanceTab'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'
import { tasksClient } from '@/lib/api-client'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
} from '@/app/workspace/[workspaceUrl]/types'

const mockStatus = useTaskStatus as jest.Mock
const mockSubmit = tasksClient.submitHumanVerdict as jest.Mock

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

function unjudgedHuman(
  over: Partial<TaskStatusCriterionView> = {}
): TaskStatusCriterionView {
  return {
    id: 'h1',
    statement: 'looks good in the running app',
    verifierType: 'HUMAN',
    checkpointer: null,
    evidenceRequired: false,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    latestVerdict: null,
    ...over,
  }
}

function render_() {
  return render(<AcceptanceTab taskIdentifier='LUM-1' enabled={true} />)
}

beforeEach(() => jest.clearAllMocks())

it('renders an empty state when the task has no criteria', () => {
  set(statusView({ criteria: [] }))
  render_()
  expect(screen.getByText('此任务暂无验收标准')).toBeInTheDocument()
})

it('leads with a verdict banner: machine passed, awaiting the human criterion', () => {
  set(
    statusView({
      criteria: [
        machinePass(),
        {
          id: 'h1',
          statement: 'looks good in the running app',
          verifierType: 'HUMAN',
          checkpointer: null,
          evidenceRequired: false,
          source: 'AGENT_DRAFT',
          addedAtRound: 0,
          latestVerdict: null,
        },
      ],
    })
  )
  render_()
  expect(
    screen.getByText('Machine acceptance passed · awaiting human verdict')
  ).toBeInTheDocument()
  expect(screen.getByText('round 1/3')).toBeInTheDocument()
})

it('renders each criterion with a result badge, type, and notable provenance', () => {
  set(
    statusView({
      criteria: [
        machinePass(),
        {
          id: 'r1',
          statement: 'gap found in review',
          verifierType: 'HUMAN',
          checkpointer: null,
          evidenceRequired: false,
          source: 'REVIEW_ADDED',
          addedAtRound: 2,
          latestVerdict: null,
        },
      ],
    })
  )
  render_()
  expect(screen.getByText('route returns 409 on lock')).toBeInTheDocument()
  expect(screen.getByText('Passed')).toBeInTheDocument()
  // REVIEW_ADDED provenance is explicitly visible; the unjudged HUMAN result.
  expect(screen.getByText('REVIEW_ADDED')).toBeInTheDocument()
  expect(screen.getByText('Awaiting human verdict')).toBeInTheDocument()
})

it('tucks a de-jargoned check command + exit code behind a disclosure', () => {
  set(statusView({ criteria: [machinePass()] }))
  render_()
  // Hidden until the disclosure is opened.
  expect(screen.queryByText(/exit code 0/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /view check output/i }))
  // The command shows; the cryptic evidence pointer is rendered as "exit code 0",
  // never the raw `cmd:…#exit=0` encoding.
  expect(screen.getByText(/npx jest x/)).toBeInTheDocument()
  expect(screen.getByText(/exit code 0/)).toBeInTheDocument()
  expect(screen.queryByText(/cmd:jest#exit=0/)).toBeNull()
})

it('marks a human-authored PASS as a human override, never a machine PASS', () => {
  // Machine PASS alone → no override marker anywhere (banner or row).
  set(statusView({ criteria: [machinePass()] }))
  const { unmount } = render_()
  expect(screen.queryByText('human override')).toBeNull()
  unmount()

  // Add a human-authored PASS → the override marker now appears.
  set(
    statusView({
      criteria: [
        machinePass(),
        {
          id: 'h1',
          statement: 'human judged',
          verifierType: 'HUMAN',
          checkpointer: null,
          evidenceRequired: false,
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
        },
      ],
    })
  )
  render_()
  expect(screen.getAllByText('human override').length).toBeGreaterThan(0)
})

it('renders the verification record and expands a round to per-criterion verdicts', () => {
  set(
    statusView({
      criteria: [
        machinePass(),
        machinePass({ id: 'm2', statement: 'second criterion' }),
      ],
      verificationHistory: [
        {
          round: 1,
          recordedAt: '2026-06-10T10:00:00.000Z',
          passed: 2,
          failed: 0,
          verdicts: [
            {
              criterionId: 'm1',
              verdict: 'PASS',
              verifierType: 'MACHINE',
              evidencePointer: 'cmd:jest#exit=0',
              rejectionReason: null,
              rejectionReasonEnum: null,
            },
            {
              criterionId: 'm2',
              verdict: 'PASS',
              verifierType: 'MACHINE',
              evidencePointer: null,
              rejectionReason: null,
              rejectionReasonEnum: null,
            },
          ],
        },
      ],
    })
  )
  render_()

  expect(screen.getByText('Verification record')).toBeInTheDocument()
  expect(screen.getByText('round 1 · machine check')).toBeInTheDocument()
  expect(screen.getByText('2/2 passed')).toBeInTheDocument()

  // Collapsed: the statement shows once (its contract row). Expanding the
  // round adds a second occurrence — the per-verdict line inside the record.
  expect(screen.getAllByText('second criterion')).toHaveLength(1)
  fireEvent.click(
    screen.getByRole('button', { name: /round 1 · machine check/i })
  )
  expect(screen.getAllByText('second criterion')).toHaveLength(2)
})

it('shows a FAIL result and reason inline on the row, with no redundant footer sections', () => {
  set(
    statusView({
      currentRound: 2,
      criteria: [
        machinePass({
          id: 'c1',
          statement: 'still failing',
          latestVerdict: {
            round: 2,
            verdict: 'FAIL',
            verifierType: 'MACHINE',
            evidencePointer: null,
            rejectionReason: 'a clear failure reason',
            rejectionReasonEnum: null,
            recordedAt: '2026-06-10T12:00:00.000Z',
          },
        }),
      ],
      // Read model still carries these; the tab no longer renders them as
      // separate blocks (redundant with the per-row result + reason).
      lastRoundFailures: [
        {
          criterionId: 'c1',
          statement: 'still failing',
          rejectionReason: 'a clear failure reason',
          rejectionReasonEnum: null,
        },
      ],
      nextActions: [
        {
          criterionId: 'c1',
          statement: 'still failing',
          verifierType: 'MACHINE',
          checkpointer: 'x',
          source: 'AGENT_DRAFT',
          addedAtRound: 0,
          rejectionReason: 'a clear failure reason',
        },
      ],
    })
  )
  render_()
  // Result + reason are on the criterion row itself.
  expect(screen.getByText('Failed')).toBeInTheDocument()
  expect(screen.getByText('a clear failure reason')).toBeInTheDocument()
  // The redundant footer sections are gone.
  expect(screen.queryByText('Last round failures')).toBeNull()
  expect(screen.queryByText('Next actions')).toBeNull()
})

// LUM-425: inline per-criterion human actions, shown only while the task is
// IN_REVIEW (the acceptance tab renders only in the Clerk web UI). An unjudged /
// HUMAN row gets a prominent pass / send-back; a machine-passed row hides its
// override behind a secondary affordance; the task-level pass-all / send-back-all
// quick action stays available.
describe('per-criterion verdict controls', () => {
  function reviewView(): TaskAcceptanceStatusView {
    return statusView({
      task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'IN_REVIEW' },
      criteria: [machinePass(), unjudgedHuman()],
    })
  }

  beforeEach(() => mockSubmit.mockResolvedValue({}))

  it('exposes prominent pass / send-back on the HUMAN row, a secondary override on the machine-passed row, and keeps the task-level quick action', () => {
    set(reviewView())
    render_()
    // Prominent controls on the unjudged HUMAN row.
    expect(screen.getByTestId('verdict-pass-h1')).toBeInTheDocument()
    expect(screen.getByTestId('verdict-sendback-h1')).toBeInTheDocument()
    // The machine-passed row: override is de-emphasized — the prominent pass
    // control is NOT directly present until the override is opened.
    expect(screen.queryByTestId('verdict-pass-m1')).toBeNull()
    expect(screen.getByTestId('verdict-override-m1')).toBeInTheDocument()
    // Task-level 'pass all / send back all' remains available.
    expect(screen.getByTestId('verdict-pass-all')).toBeInTheDocument()
    expect(screen.getByTestId('verdict-sendback-all')).toBeInTheDocument()
  })

  it('passing one HUMAN criterion calls the human-verdict client scoped to just that criterion', async () => {
    set(reviewView())
    render_()
    fireEvent.click(screen.getByTestId('verdict-pass-h1'))
    await waitFor(() =>
      expect(mockSubmit).toHaveBeenCalledWith('LUM-1', {
        verdict: 'PASS',
        criterionIds: ['h1'],
      })
    )
  })

  it('sending back one criterion submits a FAIL scoped to that criterion with the note', async () => {
    set(reviewView())
    render_()
    fireEvent.click(screen.getByTestId('verdict-sendback-h1'))
    fireEvent.change(screen.getByTestId('verdict-note-h1'), {
      target: { value: 'not what we agreed' },
    })
    fireEvent.click(screen.getByTestId('verdict-confirm-h1'))
    await waitFor(() =>
      expect(mockSubmit).toHaveBeenCalledWith('LUM-1', {
        verdict: 'FAIL',
        criterionIds: ['h1'],
        note: 'not what we agreed',
      })
    )
  })

  it('opening the machine override reveals scoped controls; the task-level quick action passes the whole contract (no criterionIds)', async () => {
    set(reviewView())
    render_()
    fireEvent.click(screen.getByTestId('verdict-override-m1'))
    expect(screen.getByTestId('verdict-pass-m1')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('verdict-pass-all'))
    await waitFor(() =>
      expect(mockSubmit).toHaveBeenCalledWith('LUM-1', { verdict: 'PASS' })
    )
  })

  it('renders no inline verdict controls when the task is not IN_REVIEW', () => {
    set(
      statusView({
        task: {
          id: 't1',
          identifier: 'LUM-1',
          title: 'x',
          status: 'IN_PROGRESS',
        },
        criteria: [machinePass(), unjudgedHuman()],
      })
    )
    render_()
    expect(screen.queryByTestId('verdict-pass-h1')).toBeNull()
    expect(screen.queryByTestId('verdict-override-m1')).toBeNull()
    expect(screen.queryByTestId('verdict-pass-all')).toBeNull()
  })
})
