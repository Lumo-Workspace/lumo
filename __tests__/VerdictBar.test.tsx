import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaskVerdictBar } from '@/app/workspace/[workspaceUrl]/components/TaskVerdictBar'
import { tasksClient } from '@/lib/api-client'
import { useBoundaryCrossings } from '@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings'
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
  tasksClient: { submitHumanVerdict: jest.fn() },
}))

// LUM-454: the bar loads the task's boundary crossings so it can render a
// compact, deduplicated DONE-blocked notice from that data instead of dumping
// the raw 409 string. Default: no crossings (the pre-454 error paths stand).
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings', () => ({
  useBoundaryCrossings: jest.fn(() => ({ crossings: [] })),
}))

// Deep link (LUM-422 ③): control the ?verdict= param per test. The variable
// must be `mock`-prefixed to be referenced inside the jest.mock factory.
let mockVerdictParam: string | null = null
jest.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (k: string) => (k === 'verdict' ? mockVerdictParam : null),
  }),
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
const mockCrossings = useBoundaryCrossings as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockVerdictParam = null
  mockCrossings.mockReturnValue({ crossings: [] })
  submit.mockResolvedValue({
    taskStatus: 'DONE',
    verdict: 'PASS',
    followUpTask: null,
  })
})

describe('TaskVerdictBar', () => {
  it('criteria gate (LUM-431): hidden for an IN_REVIEW task with no criteria, shown with criteria', () => {
    const { rerender } = render(
      <TaskVerdictBar
        taskId='t-1'
        status='IN_REVIEW'
        hasCriteria={false}
        onVerdictRecorded={jest.fn()}
      />
    )
    // The human ritual layer follows the data: no contract → nothing to judge.
    expect(screen.queryByTestId('task-verdict-bar')).toBeNull()
    rerender(
      <TaskVerdictBar
        taskId='t-1'
        status='IN_REVIEW'
        hasCriteria={true}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.getByTestId('task-verdict-bar')).toBeInTheDocument()
  })

  it('renders nothing unless the task is IN_REVIEW', () => {
    const { rerender } = render(
      <TaskVerdictBar
        taskId='t-1'
        status='IN_PROGRESS'
        hasCriteria={true}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.queryByTestId('task-verdict-bar')).toBeNull()
    rerender(
      <TaskVerdictBar
        taskId='t-1'
        status='DONE'
        hasCriteria={true}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.queryByTestId('task-verdict-bar')).toBeNull()
    rerender(
      <TaskVerdictBar
        taskId='t-1'
        status='IN_REVIEW'
        hasCriteria={true}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.getByTestId('task-verdict-bar')).toBeInTheDocument()
    expect(screen.getByTestId('verdict-pass')).toBeInTheDocument()
    expect(screen.getByTestId('verdict-followup')).toBeInTheDocument()
    expect(screen.getByTestId('verdict-fail')).toBeInTheDocument()
  })

  it('PASS posts to the human-verdict endpoint with no enum and reports the new status', async () => {
    const onRecorded = jest.fn()
    render(
      <TaskVerdictBar
        taskId='t-1'
        status='IN_REVIEW'
        hasCriteria={true}
        onVerdictRecorded={onRecorded}
      />
    )
    fireEvent.click(screen.getByTestId('verdict-pass'))
    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    expect(submit).toHaveBeenCalledWith('t-1', { verdict: 'PASS' })
    expect(onRecorded).toHaveBeenCalledWith(
      expect.objectContaining({ taskStatus: 'DONE' })
    )
  })

  it('LUM-422 ①: the FAIL panel has NO rejection-reason selector', () => {
    render(
      <TaskVerdictBar
        taskId='t-1'
        status='IN_REVIEW'
        hasCriteria={true}
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
      followUpTask: null,
    })
    render(
      <TaskVerdictBar
        taskId='t-1'
        status='IN_REVIEW'
        hasCriteria={true}
        onVerdictRecorded={jest.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('verdict-fail'))
    fireEvent.change(screen.getByTestId('verdict-comment-editor'), {
      target: { value: 'not what we agreed' },
    })
    fireEvent.click(screen.getByTestId('verdict-confirm'))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith('t-1', {
        verdict: 'FAIL',
        note: 'not what we agreed',
      })
    )
  })

  it('FAIL with no note is a bare send-back (no note field sent)', async () => {
    submit.mockResolvedValue({
      taskStatus: 'IN_PROGRESS',
      verdict: 'FAIL',
      followUpTask: null,
    })
    render(
      <TaskVerdictBar
        taskId='t-1'
        status='IN_REVIEW'
        hasCriteria={true}
        onVerdictRecorded={jest.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('verdict-fail'))
    fireEvent.click(screen.getByTestId('verdict-confirm'))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith('t-1', { verdict: 'FAIL' })
    )
  })

  it('PASS_WITH_FOLLOWUP submits the outstanding-items note and no enum', async () => {
    submit.mockResolvedValue({
      taskStatus: 'DONE',
      verdict: 'PASS_WITH_FOLLOWUP',
      followUpTask: { id: 't-fu', number: 43, title: 'follow-up: x' },
    })
    render(
      <TaskVerdictBar
        taskId='t-1'
        status='IN_REVIEW'
        hasCriteria={true}
        onVerdictRecorded={jest.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('verdict-followup'))
    expect(screen.queryByTestId('verdict-reason-select')).toBeNull()
    fireEvent.change(screen.getByTestId('verdict-note'), {
      target: { value: 'docs still missing' },
    })
    fireEvent.click(screen.getByTestId('verdict-confirm'))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith('t-1', {
        verdict: 'PASS_WITH_FOLLOWUP',
        note: 'docs still missing',
      })
    )
  })

  it('LUM-422 ③: a ?verdict=pass_with_followup deep link auto-opens the follow-up panel', () => {
    mockVerdictParam = 'pass_with_followup'
    render(
      <TaskVerdictBar
        taskId='t-1'
        status='IN_REVIEW'
        hasCriteria={true}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.getByTestId('verdict-note')).toBeInTheDocument()
  })

  it('LUM-422 ③: a ?verdict=pass deep link focuses the Pass button', () => {
    mockVerdictParam = 'pass'
    render(
      <TaskVerdictBar
        taskId='t-1'
        status='IN_REVIEW'
        hasCriteria={true}
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.getByTestId('verdict-pass')).toHaveFocus()
  })

  it('shows an inline error when the endpoint rejects', async () => {
    submit.mockRejectedValue(new Error('403'))
    render(
      <TaskVerdictBar
        taskId='t-1'
        status='IN_REVIEW'
        hasCriteria={true}
        onVerdictRecorded={jest.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('verdict-pass'))
    await waitFor(() =>
      expect(screen.getByTestId('verdict-error')).toBeInTheDocument()
    )
  })

  // LUM-453: the route returns the real error.message for every non-500 status
  // (403 human-only, 409 send-back gate, …). The bar must surface that specific
  // reason rather than swallowing it into a blanket "try again" — which is only
  // honest for possibly-transient failures (network / unknown / 5xx).
  it('verdict bar shows the server error message on a 4xx and falls back to generic only for network or 5xx', async () => {
    const renderBar = () =>
      render(
        <TaskVerdictBar
          taskId='t-1'
          status='IN_REVIEW'
          hasCriteria={true}
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
  // undispositioned returns a 409 whose raw message is a wall of red (LUM-445:
  // 3 same-category crossings = the full criterion text three times). The bar
  // must render a compact, DEDUPLICATED notice built from the loaded crossing
  // data — count + per-category counts + next action + a link to the panel —
  // and must NOT print the raw multi-line server string.
  it('acceptance tab renders a compact deduplicated DONE-blocked notice not the raw server string', async () => {
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
      <TaskVerdictBar
        taskId='t-1'
        status='IN_REVIEW'
        hasCriteria={true}
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
})
