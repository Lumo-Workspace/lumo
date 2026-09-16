import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VerdictDecision } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/VerdictDecision'
import { tasksClient } from '@/lib/api-client'
import { useBoundaryCrossings } from '@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
  AcceptanceVerdict,
} from '@/app/workspace/[workspaceUrl]/types'
// The real error class — the component imports it from this concrete module so
// it survives the `@/lib/api-client` barrel mock below; constructing real
// instances here keeps instanceof meaningful (LUM-453).
import { ApiClientError } from '@/lib/api-client/base'

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

jest.mock('@/lib/api-client', () => ({
  tasksClient: { submitHumanVerdict: jest.fn(), undoHumanVerdict: jest.fn() },
}))

// LUM-454: the decision surface loads the task's boundary crossings so it can
// render a compact, deduplicated DONE-blocked notice from that data instead of
// dumping the raw 409 string. Default: no crossings (the pre-454 paths stand).
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings', () => ({
  useBoundaryCrossings: jest.fn(() => ({ crossings: [] })),
}))

// Deep link (LUM-422 ③): control the ?verdict= param per test. The variable
// must be `mock`-prefixed to be referenced inside the jest.mock factory.
let mockVerdictParam: string | null = null
// The DONE-blocked "Review the crossings below" link routes to the Record tab
// when the panel isn't mounted — capture the push + control the pathname.
const mockPush = jest.fn()
let mockPathname = '/my-tasks/LUM-7'
jest.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (k: string) => (k === 'verdict' ? mockVerdictParam : null),
  }),
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  usePathname: () => mockPathname,
}))

// The FAIL note reuses the comment editor — mock it to a plain textarea that
// surfaces its value through onCommit (LUM-422 ①).
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

const submit = tasksClient.submitHumanVerdict as jest.Mock
const undo = tasksClient.undoHumanVerdict as jest.Mock
const mockCrossings = useBoundaryCrossings as jest.Mock

// The action buttons are wrapped in Radix-backed ActionTooltips (LUM-492);
// Radix's sizing hook needs a ResizeObserver / pointer-capture / scrollIntoView
// that jsdom doesn't provide. Shim them so mounting the buttons doesn't throw.
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (typeof global.ResizeObserver === 'undefined') {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

let seq = 0

// Mirror the verdict-status.test.ts fixture: a minimal but type-complete
// criterion + status view so deriveVerdictStatus / the banner have real data.
const crit = (
  v: AcceptanceVerdict | null,
  verifier: 'MACHINE' | 'HUMAN' = 'MACHINE'
): TaskStatusCriterionView =>
  ({
    id: `c-${seq++}`,
    statement: 's',
    verifierType: verifier,
    checkpointer: verifier === 'MACHINE' ? 'cmd:test' : null,
    evidenceRequired: false,
    judgeSteps: null,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    latestVerdict: v
      ? {
          round: 1,
          verdict: v,
          verifierType: verifier,
          evidencePointer: null,
          rejectionReason: null,
          rejectionReasonEnum: null,
          recordedAt: 'now',
        }
      : null,
    machinePassed: v === 'PASS' && verifier === 'MACHINE',
    verdictStale: false,
    checkMismatch: false,
    changeState: null,
    changedAtRound: null,
    lastEdit: null,
    confirmedAt: null,
  }) as TaskStatusCriterionView

function baseData(
  status: string,
  criteria: TaskStatusCriterionView[] = [crit('PASS')]
): TaskAcceptanceStatusView {
  return {
    version: 1,
    task: { id: 't', identifier: 'LUM-7', title: 'x', status },
    currentRound: 1,
    maxRounds: 5,
    escalated: false,
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    criteria,
    undoableHumanVerdict: null,
    lastVerdictWithdrawal: null,
  } as unknown as TaskAcceptanceStatusView
}

function dataWithUndo(
  status: string,
  criteria: TaskStatusCriterionView[] = [crit('PASS')]
): TaskAcceptanceStatusView {
  return {
    ...baseData(status, criteria),
    undoableHumanVerdict: {
      verdictActionId: 'va-1',
      verdict: 'PASS',
      actorName: 'Alice',
      at: '2026-06-25T10:00:00.000Z',
    },
  } as unknown as TaskAcceptanceStatusView
}

function dataWithWithdrawal(
  status: string,
  criteria: TaskStatusCriterionView[] = [crit('PASS')]
): TaskAcceptanceStatusView {
  return {
    ...baseData(status, criteria),
    lastVerdictWithdrawal: {
      verdict: 'PASS',
      actorName: 'Bob',
      at: '2026-06-25T11:00:00.000Z',
    },
  } as unknown as TaskAcceptanceStatusView
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVerdictParam = null
  mockCrossings.mockReturnValue({ crossings: [] })
  submit.mockResolvedValue({
    taskStatus: 'DONE',
    verdict: 'PASS',
  })
  undo.mockResolvedValue({
    taskStatus: 'IN_REVIEW',
    verdict: 'PASS',
  })
})

describe('VerdictDecision', () => {
  it('floating variant renders nothing unless the task is IN_REVIEW', () => {
    const { rerender } = render(
      <VerdictDecision
        variant='floating'
        taskIdentifier='LUM-7'
        data={baseData('IN_PROGRESS')}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.queryByTestId('task-verdict-bar')).toBeNull()
    expect(screen.queryByTestId('verdict-pass')).toBeNull()
    rerender(
      <VerdictDecision
        variant='floating'
        taskIdentifier='LUM-7'
        data={baseData('DONE')}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.queryByTestId('verdict-pass')).toBeNull()
  })

  it('floating variant + IN_REVIEW renders the action buttons', () => {
    render(
      <VerdictDecision
        variant='floating'
        taskIdentifier='LUM-7'
        data={baseData('IN_REVIEW')}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.getByTestId('task-verdict-bar')).toBeInTheDocument()
    expect(screen.getByTestId('verdict-pass')).toBeInTheDocument()
    expect(screen.queryByTestId('verdict-followup')).toBeNull()
    expect(screen.getByTestId('verdict-fail')).toBeInTheDocument()
  })

  it('header variant + DONE renders the status banner with no action buttons', () => {
    render(
      <VerdictDecision
        variant='header'
        taskIdentifier='LUM-7'
        data={baseData('DONE')}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.getByTestId('verdict-status')).toBeInTheDocument()
    expect(screen.queryByTestId('verdict-pass')).toBeNull()
    expect(screen.queryByTestId('verdict-fail')).toBeNull()
  })

  // The header path computes the banner TITLE via KIND_TITLE_ID[status.kind]
  // (a FAIL criterion derives kind `sentBack`). Guards against a regression in
  // that wiring — e.g. the header rendering the wrong kind's title id.
  it('header variant renders the sentBack title for a failing criterion', () => {
    render(
      <VerdictDecision
        variant='header'
        taskIdentifier='LUM-7'
        data={baseData('IN_REVIEW', [crit('FAIL')])}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.getByTestId('verdict-status')).toHaveTextContent(
      'acceptance.banner.sentBack'
    )
  })

  // All-PASS machine criteria with the task still awaiting a human verdict
  // derives kind `machineAwaitingHuman` / `allPassed` — assert the header path
  // wires through a passing title (not a failing one).
  it('header variant renders a passing title when every criterion passes', () => {
    render(
      <VerdictDecision
        variant='header'
        taskIdentifier='LUM-7'
        data={baseData('IN_REVIEW', [crit('PASS'), crit('PASS')])}
        onVerdictRecorded={jest.fn()}
      />
    )
    const banner = screen.getByTestId('verdict-status')
    expect(banner).not.toHaveTextContent('acceptance.banner.sentBack')
    expect(banner.textContent).toMatch(
      /acceptance\.banner\.(allPassed|machineAwaitingHuman)/
    )
  })

  it('header variant + IN_REVIEW renders both the banner and the action buttons', () => {
    render(
      <VerdictDecision
        variant='header'
        taskIdentifier='LUM-7'
        data={baseData('IN_REVIEW')}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.getByTestId('verdict-status')).toBeInTheDocument()
    expect(screen.getByTestId('verdict-pass')).toBeInTheDocument()
  })

  it('PASS posts to the human-verdict endpoint with the identifier and no enum', async () => {
    const onRecorded = jest.fn()
    render(
      <VerdictDecision
        variant='floating'
        taskIdentifier='LUM-7'
        data={baseData('IN_REVIEW')}
        onVerdictRecorded={onRecorded}
      />
    )
    fireEvent.click(screen.getByTestId('verdict-pass'))
    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    expect(submit).toHaveBeenCalledWith('LUM-7', { verdict: 'PASS' })
    expect(onRecorded).toHaveBeenCalledWith(
      expect.objectContaining({ taskStatus: 'DONE' })
    )
  })

  it('LUM-422 ①: the FAIL panel has NO rejection-reason selector', () => {
    render(
      <VerdictDecision
        variant='floating'
        taskIdentifier='LUM-7'
        data={baseData('IN_REVIEW')}
        onVerdictRecorded={jest.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('verdict-fail'))
    expect(screen.queryByTestId('verdict-reason-select')).toBeNull()
    // Confirm is enabled immediately — zero structural burden, no enum gate.
    expect(screen.getByTestId('verdict-confirm')).not.toBeDisabled()
  })

  it('FAIL submits the editor note with no rejectionReasonEnum', async () => {
    submit.mockResolvedValue({
      taskStatus: 'IN_PROGRESS',
      verdict: 'FAIL',
    })
    render(
      <VerdictDecision
        variant='floating'
        taskIdentifier='LUM-7'
        data={baseData('IN_REVIEW')}
        onVerdictRecorded={jest.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('verdict-fail'))
    fireEvent.change(screen.getByTestId('verdict-comment-editor'), {
      target: { value: 'not what we agreed' },
    })
    fireEvent.click(screen.getByTestId('verdict-confirm'))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith('LUM-7', {
        verdict: 'FAIL',
        note: 'not what we agreed',
      })
    )
  })

  it('FAIL with no note is a bare send-back (no note field sent)', async () => {
    submit.mockResolvedValue({
      taskStatus: 'IN_PROGRESS',
      verdict: 'FAIL',
    })
    render(
      <VerdictDecision
        variant='floating'
        taskIdentifier='LUM-7'
        data={baseData('IN_REVIEW')}
        onVerdictRecorded={jest.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('verdict-fail'))
    fireEvent.click(screen.getByTestId('verdict-confirm'))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith('LUM-7', { verdict: 'FAIL' })
    )
  })

  it('LUM-422 ③: a ?verdict=pass deep link focuses the Pass button', () => {
    mockVerdictParam = 'pass'
    render(
      <VerdictDecision
        variant='floating'
        taskIdentifier='LUM-7'
        data={baseData('IN_REVIEW')}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.getByTestId('verdict-pass')).toHaveFocus()
  })

  it('shows an inline error when the endpoint rejects', async () => {
    submit.mockRejectedValue(new Error('403'))
    render(
      <VerdictDecision
        variant='floating'
        taskIdentifier='LUM-7'
        data={baseData('IN_REVIEW')}
        onVerdictRecorded={jest.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('verdict-pass'))
    await waitFor(() =>
      expect(screen.getByTestId('verdict-error')).toBeInTheDocument()
    )
  })

  // LUM-453: the route returns the real error.message for every non-500 status
  // (403 human-only, 409 send-back gate, …). The surface must show that specific
  // reason rather than swallowing it into a blanket "try again" — which is only
  // honest for possibly-transient failures (network / unknown / 5xx).
  it('shows the server error message on a 4xx and falls back to generic only for network or 5xx', async () => {
    const renderBar = () =>
      render(
        <VerdictDecision
          variant='floating'
          taskIdentifier='LUM-7'
          data={baseData('IN_REVIEW')}
          onVerdictRecorded={jest.fn()}
        />
      )

    // 4xx WITH a server message → the specific reason is shown verbatim.
    const reason = 'A send-back is still open — clear it before marking done'
    submit.mockRejectedValueOnce(new ApiClientError(reason, 409))
    const a = renderBar()
    fireEvent.click(screen.getByTestId('verdict-pass'))
    await waitFor(() =>
      expect(screen.getByTestId('verdict-error')).toHaveTextContent(reason)
    )
    a.unmount()

    // 5xx → generic retry copy (the failure may be transient).
    submit.mockRejectedValueOnce(
      new ApiClientError('Internal Server Error', 500)
    )
    const b = renderBar()
    fireEvent.click(screen.getByTestId('verdict-pass'))
    await waitFor(() =>
      expect(screen.getByTestId('verdict-error')).toHaveTextContent(
        'task.verdict.error'
      )
    )
    b.unmount()

    // Network failure (a plain Error with no HTTP status) → generic.
    submit.mockRejectedValueOnce(new Error('Failed to fetch'))
    const c = renderBar()
    fireEvent.click(screen.getByTestId('verdict-pass'))
    await waitFor(() =>
      expect(screen.getByTestId('verdict-error')).toHaveTextContent(
        'task.verdict.error'
      )
    )
    c.unmount()
  })

  // LUM-454: a PASS that can't move to Done because boundary crossings are
  // undispositioned returns a 409 whose raw message is a wall of red. The
  // surface must render a compact, DEDUPLICATED notice built from the loaded
  // crossing data — count + per-category counts + next action + a link to the
  // panel — and must NOT print the raw multi-line server string.
  it('renders a compact deduplicated DONE-blocked notice not the raw server string', async () => {
    mockCrossings.mockReturnValue({
      crossings: [
        { id: 'a', category: 'TEST_TAMPERING', disposition: null },
        { id: 'b', category: 'TEST_TAMPERING', disposition: null },
        { id: 'c', category: 'TEST_TAMPERING', disposition: null },
        { id: 'd', category: 'HARDCODED_SECRET', disposition: null },
      ],
    })
    const wall =
      'Cannot move this task to DONE — 4 undispositioned boundary-crossings ' +
      '(forbidden actions taken during this task): 3 TEST_TAMPERING, ' +
      '1 HARDCODED_SECRET. A human must disposition them on the task timeline.'
    submit.mockRejectedValueOnce(new ApiClientError(wall, 409))

    render(
      <VerdictDecision
        variant='floating'
        taskIdentifier='LUM-7'
        data={baseData('IN_REVIEW')}
        onVerdictRecorded={jest.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('verdict-pass'))

    // The structured notice renders…
    await waitFor(() =>
      expect(screen.getByTestId('verdict-done-blocked')).toBeInTheDocument()
    )
    // …and the raw server string is NOT printed (no wall of red).
    expect(screen.queryByTestId('verdict-error')).toBeNull()
    expect(screen.queryByText(/Cannot move this task to DONE/)).toBeNull()

    // Deduplicated by category: TEST_TAMPERING appears once, with its count 3;
    // HARDCODED_SECRET once, with count 1 — not four near-identical lines.
    const tt = screen.getAllByTestId('verdict-blocked-cat-TEST_TAMPERING')
    expect(tt).toHaveLength(1)
    expect(tt[0]).toHaveTextContent('3')
    expect(
      screen.getByTestId('verdict-blocked-cat-HARDCODED_SECRET')
    ).toHaveTextContent('1')

    // A link points the human to the crossings panel to disposition them.
    expect(screen.getByTestId('verdict-blocked-link')).toHaveAttribute(
      'href',
      '#boundary-crossings'
    )
  })

  // The link is rendered in the floating bar ABOVE the tabs. The panel it
  // targets lives inside the Record tab, so on any other tab the anchor has
  // no target: clicking must switch to the Record tab (URL push, the tabs
  // reconcile from the URL) carrying the hash so the panel scrolls itself
  // into view once it mounts.
  async function renderBlocked() {
    mockCrossings.mockReturnValue({
      crossings: [{ id: 'a', category: 'HARDCODED_SECRET', disposition: null }],
    })
    submit.mockRejectedValueOnce(new ApiClientError('blocked', 409))
    render(
      <VerdictDecision
        variant='floating'
        taskIdentifier='LUM-7'
        data={baseData('IN_REVIEW')}
        onVerdictRecorded={jest.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('verdict-pass'))
    await waitFor(() =>
      expect(screen.getByTestId('verdict-done-blocked')).toBeInTheDocument()
    )
    return screen.getByTestId('verdict-blocked-link')
  }

  it('routes to the Record tab with the anchor when the panel is not mounted', async () => {
    mockPush.mockClear()
    mockPathname = '/my-tasks/LUM-7/activity'
    const link = await renderBlocked()
    expect(document.getElementById('boundary-crossings')).toBeNull()

    const prevented = !fireEvent.click(link)
    expect(prevented).toBe(true)
    expect(mockPush).toHaveBeenCalledWith(
      '/my-tasks/LUM-7/record#boundary-crossings',
      { scroll: false }
    )
  })

  it('keeps the plain in-page anchor jump when the panel is already mounted', async () => {
    mockPush.mockClear()
    mockPathname = '/my-tasks/LUM-7/record'
    const panel = document.createElement('div')
    panel.id = 'boundary-crossings'
    document.body.appendChild(panel)
    try {
      const link = await renderBlocked()
      const prevented = !fireEvent.click(link)
      expect(prevented).toBe(false)
      expect(mockPush).not.toHaveBeenCalled()
    } finally {
      panel.remove()
    }
  })
})

// LUM-481: the always-on header status card surfaces the latest run's summary
// so a reviewer adjudicating at IN_REVIEW sees "what the agent did" in context.
// The floating bar (the compact off-tab chrome) must NEVER carry it.
describe('VerdictDecision run summary', () => {
  it('renders run summary in header variant when provided', () => {
    render(
      <VerdictDecision
        variant='header'
        taskIdentifier='LUM-7'
        data={baseData('DONE')}
        onVerdictRecorded={jest.fn()}
        latestRunSummary='abc'
      />
    )
    expect(screen.getByTestId('verdict-run-summary')).toHaveTextContent('abc')
  })

  it('omits run summary block when null', () => {
    render(
      <VerdictDecision
        variant='header'
        taskIdentifier='LUM-7'
        data={baseData('DONE')}
        onVerdictRecorded={jest.fn()}
        latestRunSummary={null}
      />
    )
    expect(screen.queryByTestId('verdict-run-summary')).toBeNull()
  })

  it('never renders in floating variant', () => {
    render(
      <VerdictDecision
        variant='floating'
        taskIdentifier='LUM-7'
        data={baseData('IN_REVIEW')}
        onVerdictRecorded={jest.fn()}
        latestRunSummary='abc'
      />
    )
    // The floating bar renders (IN_REVIEW), but never the run-summary block.
    expect(screen.getByTestId('task-verdict-bar')).toBeInTheDocument()
    expect(screen.queryByTestId('verdict-run-summary')).toBeNull()
  })
})

// LUM-586: undo verdict affordance
describe('VerdictDecision undo affordance', () => {
  it('shows the undo opener when undoableHumanVerdict is set (header variant, DONE)', () => {
    render(
      <VerdictDecision
        variant='header'
        taskIdentifier='LUM-7'
        data={dataWithUndo('DONE')}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.getByTestId('verdict-undo')).toBeInTheDocument()
  })

  it('shows the undo opener in floating variant when undoableHumanVerdict is set', () => {
    render(
      <VerdictDecision
        variant='floating'
        taskIdentifier='LUM-7'
        data={dataWithUndo('IN_REVIEW')}
        onVerdictRecorded={jest.fn()}
      />
    )
    // floating variant renders when IN_REVIEW
    expect(screen.getByTestId('verdict-undo')).toBeInTheDocument()
  })

  it('does NOT show the undo opener when undoableHumanVerdict is null', () => {
    render(
      <VerdictDecision
        variant='header'
        taskIdentifier='LUM-7'
        data={baseData('DONE')}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.queryByTestId('verdict-undo')).toBeNull()
  })

  it('LUM-586 undo affordance calls the undo endpoint', async () => {
    const onRecorded = jest.fn()
    render(
      <VerdictDecision
        variant='header'
        taskIdentifier='LUM-7'
        data={dataWithUndo('DONE')}
        onVerdictRecorded={onRecorded}
      />
    )
    // Click the opener
    fireEvent.click(screen.getByTestId('verdict-undo'))
    // Confirm dialog appears
    expect(screen.getByTestId('verdict-undo-confirm')).toBeInTheDocument()
    // Click the destructive confirm
    fireEvent.click(screen.getByTestId('verdict-undo-confirm'))
    await waitFor(() => expect(undo).toHaveBeenCalledWith('LUM-7'))
    expect(onRecorded).toHaveBeenCalled()
  })

  it('renders the correction line when lastVerdictWithdrawal is set', () => {
    render(
      <VerdictDecision
        variant='header'
        taskIdentifier='LUM-7'
        data={dataWithWithdrawal('IN_REVIEW')}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.getByTestId('verdict-withdrawn')).toBeInTheDocument()
    // The correction line renders with the withdrawal message key
    expect(screen.getByTestId('verdict-withdrawn')).toHaveTextContent(
      'task.verdict.withdrawnBy'
    )
  })

  it('does NOT show the correction line when lastVerdictWithdrawal is null', () => {
    render(
      <VerdictDecision
        variant='header'
        taskIdentifier='LUM-7'
        data={baseData('DONE')}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.queryByTestId('verdict-withdrawn')).toBeNull()
  })

  // MINOR 1: floating + DONE + undoableHumanVerdict → undo bar renders but Pass/Fail do not
  it('floating variant + DONE + undoableHumanVerdict renders undo bar but not Pass/Fail buttons', () => {
    render(
      <VerdictDecision
        variant='floating'
        taskIdentifier='LUM-7'
        data={dataWithUndo('DONE')}
        onVerdictRecorded={jest.fn()}
      />
    )
    // The bar should be present because hasUndoContent is true
    expect(screen.getByTestId('task-verdict-bar')).toBeInTheDocument()
    // Undo opener present
    expect(screen.getByTestId('verdict-undo')).toBeInTheDocument()
    // But DONE task should NOT have Pass / Fail action buttons
    expect(screen.queryByTestId('verdict-pass')).toBeNull()
    expect(screen.queryByTestId('verdict-fail')).toBeNull()
  })

  // MINOR 2a: undo endpoint rejection surfaces verdict-undo-error and does not call onVerdictRecorded
  it('surfaces verdict-undo-error when undoHumanVerdict rejects', async () => {
    undo.mockRejectedValueOnce(new Error('network error'))
    const onRecorded = jest.fn()
    render(
      <VerdictDecision
        variant='header'
        taskIdentifier='LUM-7'
        data={dataWithUndo('DONE')}
        onVerdictRecorded={onRecorded}
      />
    )
    // Open the confirm
    fireEvent.click(screen.getByTestId('verdict-undo'))
    expect(screen.getByTestId('verdict-undo-confirm')).toBeInTheDocument()
    // Click confirm — will reject
    fireEvent.click(screen.getByTestId('verdict-undo-confirm'))
    await waitFor(() =>
      expect(screen.getByTestId('verdict-undo-error')).toBeInTheDocument()
    )
    expect(onRecorded).not.toHaveBeenCalled()
    // Confirm button must be re-enabled (undoing=false from finally)
    expect(screen.getByTestId('verdict-undo-confirm')).not.toBeDisabled()
  })
})
