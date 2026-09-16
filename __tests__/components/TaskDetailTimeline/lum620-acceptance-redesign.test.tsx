/** @jest-environment jsdom */
/**
 * LUM-620: Acceptance container visual redesign. Encodes the new information
 * architecture: the human "Needs your judgment" zone leads above the collapsible
 * "Machine-verified" summary; the Decision Hero's Approve preserves the existing
 * task-level PASS verdict; and the forensic signals (gates, boundary crossings,
 * verification rounds, run cost) live in a demoted, collapsed "Evidence & audit
 * trail" card that is explicitly not a verdict input (LUM-614 red line).
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

// tasksClient — the verdict write path (test 2) + AcceptanceTab's own calls.
jest.mock('@/lib/api-client', () => ({
  tasksClient: {
    submitHumanVerdict: jest.fn(() =>
      Promise.resolve({ taskStatus: 'DONE', verdict: 'PASS' })
    ),
    undoHumanVerdict: jest.fn(),
    reviseCriteria: jest.fn(() => Promise.resolve({})),
  },
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings', () => ({
  useBoundaryCrossings: jest.fn(() => ({ crossings: [] })),
}))

jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/my-tasks/LUM-1',
}))

// Bare anchor so ordering / presence can be asserted without a full fixture.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BoundaryCrossingsPanel',
  () => ({
    BoundaryCrossingsPanel: () => <div id='boundary-crossings' />,
  })
)

// Leaf honest-report sections → bare anchors (their internals have own tests).
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/HonestReportSections',
  () => ({
    ClaimVsVerification: () => <div data-testid='claim-vs' />,
    CostSection: () => <div data-testid='cost' />,
    StruggleTrailSection: () => <div data-testid='struggle' />,
    TrendSection: () => <div data-testid='trend' />,
    // LUM-496: the struggle disclosure borrows the section's heading copy; the
    // KPI tiles borrow its token formatter.
    STRUGGLE_TITLE: {
      id: 'acceptance.struggle.title',
      defaultMessage: 'Struggle / rework / outstanding',
    },
    STRUGGLE_TIP: { id: 'acceptance.struggle.tip', defaultMessage: 'tip' },
    fmtTokens: (n: number) => String(n),
  })
)

// The FAIL note reuses the comment editor — stub it (VerdictDecision imports it).
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/comments/CommentEditor',
  () => ({
    CommentEditor: ({
      onCommit,
    }: {
      onCommit: (html: string | null) => void
    }) => (
      <textarea
        data-testid='verdict-comment-editor'
        onChange={e => onCommit(e.target.value)}
      />
    ),
  })
)

import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AcceptanceTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AcceptanceTab'
import { VerdictDecision } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/VerdictDecision'
import { tasksClient } from '@/lib/api-client'
import { useTaskStatus } from '@/app/workspace/[workspaceUrl]/hooks/useTaskStatus'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
} from '@/app/workspace/[workspaceUrl]/types'

const mockStatus = useTaskStatus as jest.Mock
const submit = tasksClient.submitHumanVerdict as jest.Mock

// Radix ActionTooltip needs these jsdom shims to mount without throwing.
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
})

let seq = 0
function crit(
  verifier: 'MACHINE' | 'HUMAN',
  verdict: 'PASS' | 'FAIL' | null,
  over: Partial<TaskStatusCriterionView> = {}
): TaskStatusCriterionView {
  return {
    id: `c-${seq++}`,
    statement: verifier === 'HUMAN' ? 'reads well to a person' : 'route 409s',
    verifierType: verifier,
    checkpointer: verifier === 'MACHINE' ? 'npx jest x' : null,
    evidenceRequired: false,
    judgeSteps: null,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    latestVerdict: verdict
      ? {
          round: 1,
          verdict,
          verifierType: verifier,
          evidencePointer: verifier === 'MACHINE' ? 'cmd:jest#exit=0' : null,
          rejectionReason: null,
          rejectionReasonEnum: null,
          recordedAt: 'now',
        }
      : null,
    machinePassed: verdict === 'PASS' && verifier === 'MACHINE',
    verdictStale: false,
    checkMismatch: false,
    changeState: null,
    changedAtRound: null,
    lastEdit: null,
    ...over,
  } as unknown as TaskStatusCriterionView
}

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
    machineVerification: { total: 1, machineVerified: 1, humanOverridden: 0 },
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    ...over,
  } as unknown as TaskAcceptanceStatusView
}

function renderTab() {
  return render(
    <AcceptanceTab
      taskIdentifier='LUM-1'
      enabled
      onVerdictRecorded={jest.fn()}
      gatesSlot={<div data-testid='gates-slot' />}
      securitySlot={<div data-testid='security-slot' />}
    />
  )
}

describe('LUM-620 · Acceptance redesign', () => {
  it('human judgment zone renders above the machine-verified zone', () => {
    // LUM-789 overturns this fixture: a null-verdict (un-adjudicated) HUMAN
    // criterion is now a tacit pass and no longer lands in NEEDS ACTION, so it
    // can no longer stand in for "the human zone is pending" here. An explicit
    // FAIL (a real send-back) is what still puts the zone in NEEDS ACTION —
    // this test only cares about DOM ordering once it's there.
    mockStatus.mockReturnValue({
      data: statusView({
        criteria: [crit('MACHINE', 'PASS'), crit('HUMAN', 'FAIL')],
      }),
      loading: false,
      error: null,
      refresh: jest.fn(),
      optimisticallyPass: jest.fn(),
    })
    renderTab()
    const human = screen.getByText('Needs your judgment')
    const machine = screen.getByText('Machine-verified')
    // Human precedes machine in DOM order (elevated above the summary).
    expect(
      human.compareDocumentPosition(machine) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('empty human zone hides on a DONE task but stays while editable', () => {
    // DONE + zero human criteria → an empty 0/0 zone is pure noise; gone.
    mockStatus.mockReturnValue({
      data: statusView({
        task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'DONE' },
        criteria: [crit('MACHINE', 'PASS')],
      }),
      loading: false,
      error: null,
      refresh: jest.fn(),
      optimisticallyPass: jest.fn(),
    })
    const { unmount } = renderTab()
    expect(screen.queryByText('Needs your judgment')).toBeNull()
    expect(screen.queryByText('Human-judged')).toBeNull()
    unmount()

    // Contract still editable (not DONE) → the zone stays even at zero
    // criteria: it carries the add-criterion entry. LUM-496: at zero criteria
    // it wears its own empty-shell title — there is no pending call to name.
    mockStatus.mockReturnValue({
      data: statusView({ criteria: [crit('MACHINE', 'PASS')] }),
      loading: false,
      error: null,
      refresh: jest.fn(),
      optimisticallyPass: jest.fn(),
    })
    renderTab()
    expect(screen.getByText('Human acceptance criteria')).toBeInTheDocument()
  })

  it('decision hero Approve submits a task-level PASS verdict', async () => {
    render(
      <VerdictDecision
        variant='floating'
        taskIdentifier='LUM-1'
        data={statusView({
          task: {
            id: 't1',
            identifier: 'LUM-1',
            title: 'x',
            status: 'IN_REVIEW',
          },
          criteria: [crit('MACHINE', 'PASS')],
        })}
        onVerdictRecorded={jest.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('verdict-pass'))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    // Task-level PASS — no per-criterion criterionIds in the payload.
    const [identifier, payload] = submit.mock.calls[0]
    expect(identifier).toBe('LUM-1')
    expect(payload.verdict).toBe('PASS')
    expect(payload.criterionIds).toBeUndefined()
  })

  it('audit-only region keeps gates, boundary crossings, verification rounds and cost with a not-a-verdict label', () => {
    mockStatus.mockReturnValue({
      data: statusView({
        criteria: [crit('MACHINE', 'PASS'), crit('HUMAN', 'PASS')],
        verificationHistory: [
          {
            round: 1,
            recordedAt: '2026-06-30T00:00:00.000Z',
            passed: 1,
            failed: 0,
            verdicts: [
              {
                criterionId: 'c-0',
                verdict: 'PASS',
                verifierType: 'MACHINE',
                evidencePointer: null,
                rejectionReason: null,
                rejectionReasonEnum: null,
                withdrawn: false,
              },
            ],
          },
        ],
      }),
      loading: false,
      error: null,
      refresh: jest.fn(),
      optimisticallyPass: jest.fn(),
    })
    renderTab()
    // LUM-635: the boundary panel is promoted OUT of the audit fold — its
    // anchor is live while the fold is still collapsed (an open crossing is an
    // actionable Done-blocker, not forensics)…
    expect(document.querySelector('#boundary-crossings')).not.toBeNull()
    // …and the audit fold's not-a-verdict label sits on its header (the
    // per-strip caption under claim-vs-verification was dropped).
    expect(
      screen.getByText(/these signals don't decide the verdict/i)
    ).toBeInTheDocument()
    // The remaining forensic signals live inside the demoted, collapsed audit
    // card — expand it, then assert every signal is present (nothing dropped).
    fireEvent.click(screen.getByText('Evidence & audit trail'))
    expect(screen.getByTestId('gates-slot')).toBeInTheDocument()
    expect(screen.getByText('Verification record')).toBeInTheDocument()
    // LUM-496: run cost left the fold for the Run report's Cost KPI tile —
    // still rendered, one group down, not dropped.
    expect(screen.queryByTestId('cost')).toBeNull()
    expect(screen.getByTestId('tile-costTokens')).toBeInTheDocument()
  })

  it('security scan sits OUTSIDE the audit fold — visible while it is collapsed', () => {
    // LUM-732 review I3: an undispositioned HIGH finding hard-blocks DONE, so
    // the panel carrying that banner is an actionable to-do like the boundary
    // crossings (LUM-635) — not forensics. Filed under "audit-only — these
    // signals don't decide the verdict" it was both hidden by default and
    // labelled as not mattering, while the API refuses the DONE transition.
    mockStatus.mockReturnValue({
      data: statusView({ criteria: [crit('HUMAN', null)] }),
      loading: false,
      error: null,
      refresh: jest.fn(),
      optimisticallyPass: jest.fn(),
    })
    renderTab()
    // Fold still closed: its own contents are absent, the security slot is not.
    expect(screen.queryByTestId('gates-slot')).toBeNull()
    expect(screen.getByTestId('security-slot')).toBeInTheDocument()
  })

  it('human zone reads resolved (not a pending call) once every human criterion is judged', () => {
    mockStatus.mockReturnValue({
      data: statusView({
        criteria: [crit('HUMAN', 'PASS'), crit('HUMAN', 'PASS')],
      }),
      loading: false,
      error: null,
      refresh: jest.fn(),
      optimisticallyPass: jest.fn(),
    })
    renderTab()
    // Signed off → resolved header, NOT the pending "Needs your judgment".
    expect(screen.getByText('Human-judged')).toBeInTheDocument()
    expect(screen.queryByText('Needs your judgment')).toBeNull()
  })

  it('human zone is resolved on an accepted (DONE) task even without per-criterion human verdicts', () => {
    mockStatus.mockReturnValue({
      data: statusView({
        task: { id: 't1', identifier: 'LUM-1', title: 'x', status: 'DONE' },
        // A task-level Approve marks the task DONE without recording a
        // per-criterion HUMAN verdict — the zone must still read as resolved,
        // not a pending magenta call-to-action.
        criteria: [crit('HUMAN', null), crit('HUMAN', null)],
      }),
      loading: false,
      error: null,
      refresh: jest.fn(),
      optimisticallyPass: jest.fn(),
    })
    renderTab()
    expect(screen.getByText('Human-judged')).toBeInTheDocument()
    expect(screen.queryByText('Needs your judgment')).toBeNull()
  })
})
