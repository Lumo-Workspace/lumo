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
    judgeSteps: null,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    latestVerdict: null,
    machinePassed: false,
    verdictStale: false,
    checkMismatch: false,
    changeState: null,
    changedAtRound: null,
    lastEdit: null,
    ...over,
  }
}

function render_() {
  return render(<AcceptanceTab taskIdentifier='LUM-1' enabled={true} />)
}

// LUM-451: the machine-verified zone collapses by default when every machine
// criterion passes. Tests that assert on a passing machine ROW must expand it.
function expandMachine() {
  fireEvent.click(screen.getByRole('button', { name: /Machine-verified/i }))
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
          judgeSteps: null,
          source: 'AGENT_DRAFT',
          addedAtRound: 0,
          latestVerdict: null,
          machinePassed: false,
          verdictStale: false,
          checkMismatch: false,
          changeState: null,
          changedAtRound: null,
          lastEdit: null,
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
          judgeSteps: null,
          source: 'REVIEW_ADDED',
          addedAtRound: 2,
          latestVerdict: null,
          machinePassed: false,
          verdictStale: false,
          checkMismatch: false,
          changeState: null,
          changedAtRound: null,
          lastEdit: null,
        },
      ],
    })
  )
  render_()
  expandMachine()
  expect(screen.getByText('route returns 409 on lock')).toBeInTheDocument()
  expect(screen.getByText('Passed')).toBeInTheDocument()
  // REVIEW_ADDED provenance is explicitly visible; the unjudged HUMAN result.
  expect(screen.getByText('REVIEW_ADDED')).toBeInTheDocument()
  expect(screen.getByText('Awaiting human verdict')).toBeInTheDocument()
})

it('renders judgeSteps on a HUMAN criterion card with a clickable URL (LUM-465)', () => {
  set(
    statusView({
      criteria: [
        unjudgedHuman({
          judgeSteps:
            'Open the acceptance tab at https://app.test/x. Read the steps. Pass if URLs click.',
        }),
      ],
    })
  )
  render_()
  expect(screen.getByText('How to judge')).toBeInTheDocument()
  const link = screen.getByRole('link', { name: 'https://app.test/x' })
  expect(link).toHaveAttribute('href', 'https://app.test/x')
})

it('shows the missing-guidance fallback for a HUMAN criterion without judgeSteps (LUM-465)', () => {
  set(statusView({ criteria: [unjudgedHuman({ judgeSteps: null })] }))
  render_()
  expect(screen.getByTestId('judge-steps-missing')).toBeInTheDocument()
  expect(screen.queryByText('How to judge')).toBeNull()
})

it('tucks a de-jargoned check command + exit code behind a disclosure', () => {
  set(statusView({ criteria: [machinePass()] }))
  render_()
  expandMachine()
  // Hidden until the disclosure is opened.
  expect(screen.queryByText(/exit code 0/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /view check output/i }))
  // The command shows; the cryptic evidence pointer is rendered as "exit code 0",
  // never the raw `cmd:…#exit=0` encoding.
  expect(screen.getByText(/npx jest x/)).toBeInTheDocument()
  expect(screen.getByText(/exit code 0/)).toBeInTheDocument()
  expect(screen.queryByText(/cmd:jest#exit=0/)).toBeNull()
})

it('marks a human-carried MACHINE criterion as a human override, never a machine PASS (LUM-456)', () => {
  // A genuine machine PASS (machinePassed) → no override marker anywhere.
  set(statusView({ criteria: [machinePass()] }))
  const { unmount } = render_()
  expect(screen.queryByText('human override')).toBeNull()
  unmount()

  // A MACHINE criterion passing with NO checkpointer pass behind it
  // (machinePassed: false, latest verdict authored by a HUMAN) → override.
  set(
    statusView({
      criteria: [
        machinePass(),
        machinePass({
          id: 'm2',
          statement: 'no checkpointer pass — carried by a human',
          machinePassed: false,
          verdictStale: false,
          checkMismatch: false,
          latestVerdict: {
            round: 1,
            verdict: 'PASS',
            verifierType: 'HUMAN',
            evidencePointer: null,
            rejectionReason: null,
            rejectionReasonEnum: null,
            recordedAt: '2026-06-10T11:00:00.000Z',
          },
        }),
      ],
    })
  )
  render_()
  // The override surfaces the machine zone by default (not all verified), so
  // the row renders without expanding; the banner flags it too.
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
  expandMachine()

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
          judgeSteps: null,
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
    expandMachine()
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
    expandMachine()
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

// LUM-437: change-state markers (Edited/Added) and removed-criteria section.
describe('change-state markers and removed criteria (LUM-437)', () => {
  it('shows the Edited marker on a criterion with changeState edited, and reveals old→new on disclosure', () => {
    set(
      statusView({
        criteria: [
          machinePass({
            id: 'e1',
            statement: 'the edited criterion',
            changeState: 'edited',
            changedAtRound: 2,
            lastEdit: {
              before: 'old statement text',
              after: 'new statement text',
            },
          }),
        ],
      })
    )
    render_()
    expandMachine()

    // A — Edited marker is visible.
    expect(screen.getByText('Edited · round 2')).toBeInTheDocument()

    // B — "View change" disclosure is present but collapsed by default.
    expect(screen.queryByText('old statement text')).toBeNull()
    expect(screen.queryByText('new statement text')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /view change/i }))

    expect(screen.getByText('old statement text')).toBeInTheDocument()
    expect(screen.getByText('new statement text')).toBeInTheDocument()
  })

  it('shows the Added marker on a criterion with changeState added', () => {
    set(
      statusView({
        criteria: [
          machinePass({
            id: 'a1',
            statement: 'a newly added criterion',
            changeState: 'added',
            changedAtRound: 1,
            lastEdit: null,
          }),
        ],
      })
    )
    render_()
    expandMachine()
    expect(screen.getByText('Added · round 1')).toBeInTheDocument()
  })

  it('renders the Removed section header with count, expands to show statement and last verdict FAIL', () => {
    set(
      statusView({
        criteria: [machinePass()],
        removedCriteria: [
          {
            id: 'rc1',
            statement: 'this was removed',
            verifierType: 'MACHINE',
            removedAtRound: 2,
            runCount: 3,
            lastVerdict: {
              round: 2,
              verdict: 'FAIL',
              verifierType: 'MACHINE',
              evidencePointer: null,
              rejectionReason: 'did not pass',
              rejectionReasonEnum: null,
              recordedAt: '2026-06-10T10:00:00.000Z',
            },
          },
        ],
      })
    )
    render_()

    // C — section header with count is visible.
    expect(screen.getByText('Removed · kept for audit')).toBeInTheDocument()
    expect(screen.getByText('(1)')).toBeInTheDocument()

    // Collapsed: removed statement not yet visible.
    expect(screen.queryByText('this was removed')).toBeNull()

    // Open the disclosure.
    fireEvent.click(
      screen.getByRole('button', { name: /removed · kept for audit/i })
    )

    expect(screen.getByText('this was removed')).toBeInTheDocument()
    expect(screen.getByText('last verdict: FAIL')).toBeInTheDocument()
    expect(screen.getByText('Removed at round 2')).toBeInTheDocument()
    expect(
      screen.getByText('3 verification run(s) preserved')
    ).toBeInTheDocument()
  })
})
