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
    // LUM-789: the "Confirm contract" button's POST.
    confirmCriteria: jest.fn().mockResolvedValue({ confirmedCount: 1 }),
  },
}))

// LUM-467: the tab now leads with the shared `header` VerdictDecision and
// removed its own VerdictBanner. Stub it to a status surface so these tests stay
// focused on the tab's own composition (reorder, no whole-contract control)
// without pulling VerdictDecision's verdict-ritual subtree + its deps.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/VerdictDecision',
  () => ({
    VerdictDecision: () => <div data-testid='verdict-status' />,
  })
)

// Stub the panel to a bare anchor div so the ordering test can assert position
// without constructing a full BoundaryCrossingView fixture. `#boundary-crossings`
// matches the real panel's root id.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BoundaryCrossingsPanel',
  () => ({
    // LUM-496: the tab mounts the panel twice — the open subset in NEEDS
    // ACTION, the dispositioned one in the records — so the stub distinguishes
    // them by the `subset` prop the tab passes.
    BoundaryCrossingsPanel: ({ subset }: { subset?: string }) => (
      <div id={subset === 'open' ? 'record-crossings' : 'boundary-crossings'} />
    ),
  })
)

import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AcceptanceTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AcceptanceTab'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'
import { useBoundaryCrossings } from '@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings'
import { tasksClient } from '@/lib/api-client'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
} from '@/app/workspace/[workspaceUrl]/types'

const mockStatus = useTaskStatus as jest.Mock
const mockSubmit = tasksClient.submitHumanVerdict as jest.Mock
const mockConfirm = tasksClient.confirmCriteria as jest.Mock

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
  return render(
    <AcceptanceTab
      taskIdentifier='LUM-1'
      enabled={true}
      onVerdictRecorded={jest.fn()}
    />
  )
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

// LUM-520: a task can have a boundary crossing but no acceptance criteria. The
// crossings panel must NOT be swallowed by the "no criteria" empty state — it
// renders alongside the empty note so the crossing is visible.
it('renders boundary crossings when the contract is empty', () => {
  ;(useBoundaryCrossings as jest.Mock).mockReturnValue({
    crossings: [{ id: 'c1' }],
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
  set(statusView({ criteria: [] }))
  const { container } = render_()
  // LUM-620: boundary crossings live inside the demoted, collapsed "Evidence &
  // audit trail" card — expand it before asserting the panel renders.
  fireEvent.click(screen.getByText('Evidence & audit trail'))
  // Both surface: the panel (anchor id) and the no-criteria note.
  expect(container.querySelector('#boundary-crossings')).not.toBeNull()
  expect(screen.getByText('此任务暂无验收标准')).toBeInTheDocument()
})

// LUM-467: the verdict banner moved into the shared header VerdictDecision (it
// owns the status text + round badge now, covered by VerdictDecision's tests).
// The tab's job is to lead with that surface — assert it's first.
it('leads with the header verdict surface', () => {
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
  expect(screen.getByTestId('verdict-status')).toBeInTheDocument()
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
  // LUM-620: the verification record now lives inside the demoted, collapsed
  // "Evidence & audit trail" card — expand it to reveal the round history.
  fireEvent.click(screen.getByText('Evidence & audit trail'))
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

// LUM-467: the tab leads with the shared header VerdictDecision (replacing the
// old VerdictBanner AND the bottom whole-contract pass/send-back), and reorders
// so the criteria contract sits before the boundary-crossings panel.
describe('header verdict surface + section order (LUM-467)', () => {
  function reviewView(): TaskAcceptanceStatusView {
    return statusView({
      task: { id: 't1', identifier: 'LUM-7', title: 'x', status: 'IN_REVIEW' },
      criteria: [machinePass(), unjudgedHuman()],
    })
  }

  it('suppresses the in-content header verdict during review and keeps no whole-contract control', () => {
    set(reviewView())
    render(
      <AcceptanceTab
        taskIdentifier='LUM-7'
        enabled
        onVerdictRecorded={jest.fn()}
      />
    )
    // During IN_REVIEW the verdict is shown once as the pinned floating bar
    // (rendered by TimelineTabs); the in-content header is suppressed here so
    // there is never a duplicate. The whole-contract control stays gone too.
    expect(screen.queryByTestId('verdict-status')).toBeNull()
    expect(screen.queryByText(/whole contract|整份合约/i)).toBeNull()
  })

  // LUM-619: boundary crossings are now a forensic (audit-only) signal inside
  // the Acceptance container, below the audit-only separator — so the criteria
  // contract (verdict basis) sits ABOVE the boundary-crossings panel
  // (supersedes the LUM-572 boundary-leads order).
  it('puts the criteria contract above the boundary crossings panel', () => {
    set(reviewView())
    const { container } = render(
      <AcceptanceTab
        taskIdentifier='LUM-7'
        enabled
        onVerdictRecorded={jest.fn()}
      />
    )
    // LUM-620: boundary crossings are inside the demoted, collapsed "Evidence &
    // audit trail" card (which sits below the criteria) — expand it to assert
    // the panel renders after the contract.
    fireEvent.click(screen.getByText('Evidence & audit trail'))
    const contract = screen.getByText('Machine-verified')
    const panel = container.querySelector('#boundary-crossings')
    expect(panel).not.toBeNull()
    // contract precedes the boundary panel in DOM order.
    expect(
      contract.compareDocumentPosition(panel!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})

// LUM-425: inline per-criterion human actions, shown only while the task is
// IN_REVIEW (the acceptance tab renders only in the Clerk web UI). An unjudged /
// HUMAN row gets a prominent pass / send-back; a machine-passed row hides its
// override behind a secondary affordance; the task-level pass-all / send-back-all
// quick action stays available.
describe('per-criterion verdict controls', () => {
  /** A HUMAN criterion a human already sent back — the standing send-back
   *  that (LUM-733) unlocks the per-criterion controls on the other rows. */
  function sentBackHuman(): TaskAcceptanceStatusView['criteria'][number] {
    return {
      ...unjudgedHuman(),
      id: 'h9',
      statement: 'sent back earlier',
      latestVerdict: {
        round: 1,
        verdict: 'FAIL',
        evidencePointer: null,
        rejectionReason: 'not there yet',
        rejectionReasonEnum: null,
        recordedAt: '2026-06-01T00:00:00.000Z',
      },
    } as TaskAcceptanceStatusView['criteria'][number]
  }
  function reviewView(): TaskAcceptanceStatusView {
    return statusView({
      task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'IN_REVIEW' },
      criteria: [machinePass(), unjudgedHuman(), sentBackHuman()],
    })
  }

  beforeEach(() => mockSubmit.mockResolvedValue({}))

  it('LUM-733: per-criterion controls stay hidden until a send-back stands — the whole-task decision is the default', () => {
    set(
      statusView({
        task: {
          id: 't1',
          identifier: 'LUM-1',
          title: 'x',
          status: 'IN_REVIEW',
        },
        criteria: [machinePass(), unjudgedHuman()],
      })
    )
    render_()
    expandMachine()
    expect(screen.queryByTestId('verdict-pass-h1')).toBeNull()
    expect(screen.queryByTestId('verdict-sendback-h1')).toBeNull()
    expect(screen.queryByTestId('verdict-override-m1')).toBeNull()
  })

  it('exposes prominent pass / send-back on the HUMAN row and a secondary override on the machine-passed row', () => {
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
    // LUM-467: the task-level whole-contract quick action is gone — its job is
    // now the header VerdictDecision's verdict ritual.
    expect(screen.queryByTestId('verdict-pass-all')).toBeNull()
    expect(screen.queryByTestId('verdict-sendback-all')).toBeNull()
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

  it('opening the machine override reveals scoped controls that pass just that criterion', async () => {
    set(reviewView())
    render_()
    expandMachine()
    fireEvent.click(screen.getByTestId('verdict-override-m1'))
    expect(screen.getByTestId('verdict-pass-m1')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('verdict-pass-m1'))
    await waitFor(() =>
      expect(mockSubmit).toHaveBeenCalledWith('LUM-1', {
        verdict: 'PASS',
        criterionIds: ['m1'],
      })
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
    // LUM-572: the removed-criteria audit sits inside the Run report group.
    // LUM-496: that group opens by default, so the header is already reachable.
    expect(screen.getByRole('button', { name: /Run report/i })).toHaveAttribute(
      'aria-expanded',
      'true'
    )

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

// LUM-602: effective referentKind badge
describe('referentKind badge (LUM-602)', () => {
  // A MACHINE criterion with EXTERNAL_FACT declared but a jest (AGENT_HARNESS)
  // checkpointer → effectiveReferentKind returns UNVERIFIED_ASSERTION (the check
  // doesn't earn external-fact status). Badge should show "Unverified".
  it('shows UNVERIFIED_ASSERTION badge for EXTERNAL_FACT + non-external checkpointer', () => {
    set(
      statusView({
        criteria: [
          machinePass({
            id: 'ef1',
            statement: 'external fact criterion',
            referentKind: 'EXTERNAL_FACT',
            checkpointer: 'npx jest x',
          }),
        ],
      })
    )
    render_()
    // The machine zone is open by default because not all machine criteria pass
    // (ef1 has machinePassed: true, so they are all passing → zone collapses).
    // We must expand it to see the row.
    expandMachine()
    expect(screen.getByTestId('referent-kind-badge')).toBeInTheDocument()
    expect(screen.getByText('Unverified')).toBeInTheDocument()
  })

  // A MACHINE criterion with EXTERNAL_FACT declared and a real external
  // checkpointer (e.g. git) → effectiveReferentKind returns EXTERNAL_FACT.
  // Badge should show "External fact".
  it('shows EXTERNAL_FACT badge for EXTERNAL_FACT + external checkpointer', () => {
    set(
      statusView({
        criteria: [
          machinePass({
            id: 'ef2',
            statement: 'git-verified fact',
            referentKind: 'EXTERNAL_FACT',
            checkpointer: 'git log --oneline -1',
          }),
        ],
      })
    )
    render_()
    expandMachine()
    expect(screen.getByTestId('referent-kind-badge')).toBeInTheDocument()
    expect(screen.getByText('External fact')).toBeInTheDocument()
  })

  // A criterion with no referentKind (null/undefined, legacy row) → no badge at all.
  it('renders no referentKind badge when referentKind is null', () => {
    set(
      statusView({
        criteria: [
          machinePass({
            id: 'nk1',
            statement: 'legacy criterion no referentKind',
            // referentKind is not set (undefined) — matches null/legacy behavior
          }),
        ],
      })
    )
    render_()
    expandMachine()
    expect(screen.queryByTestId('referent-kind-badge')).toBeNull()
  })
})

// ── LUM-789: tacit-pass badge + "Confirm contract" ─────────────────────────
// An un-adjudicated HUMAN criterion is a tacit pass, not a to-do (Task 1's
// isUnmetForDisplay) — the badge must not count it, unlike a genuinely unmet
// MACHINE criterion. Separately, an un-confirmed contract surfaces one
// optional "Confirm contract" affordance; confirming never touches task
// status (it has no gate of its own).
describe('LUM-789: contract confirmation', () => {
  it('未裁定的 HUMAN 项不计入待办徽章', () => {
    set(
      statusView({
        criteria: [
          unjudgedHuman({ id: 'c1', confirmedAt: null }),
          machinePass({
            id: 'c2',
            latestVerdict: null,
            machinePassed: false,
            confirmedAt: null,
          }),
        ],
      })
    )
    render_()
    expect(screen.getByTestId('pending-count')).toHaveTextContent('1')
  })

  it('合同未确认时显示「确认合同」按钮', () => {
    set(
      statusView({
        criteria: [unjudgedHuman({ id: 'c1', confirmedAt: null })],
      })
    )
    render_()
    expect(
      screen.getByRole('button', { name: /confirm contract/i })
    ).toBeInTheDocument()
  })

  it('合同已全部确认时不显示「确认合同」按钮', () => {
    set(
      statusView({
        criteria: [
          unjudgedHuman({ id: 'c1', confirmedAt: '2026-06-10T10:00:00.000Z' }),
        ],
      })
    )
    render_()
    expect(
      screen.queryByRole('button', { name: /confirm contract/i })
    ).toBeNull()
  })

  it('点击「确认合同」调用 tasksClient.confirmCriteria 并刷新，不改任务状态', async () => {
    const refresh = jest.fn()
    mockStatus.mockReturnValue({
      data: statusView({
        criteria: [unjudgedHuman({ id: 'c1', confirmedAt: null })],
      }),
      loading: false,
      error: null,
      refresh,
    })
    render_()
    fireEvent.click(screen.getByRole('button', { name: /confirm contract/i }))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith('LUM-1'))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
})
