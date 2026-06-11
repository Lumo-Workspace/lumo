import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaskVerdictBar } from '@/app/workspace/[workspaceUrl]/components/TaskVerdictBar'
import { tasksClient } from '@/lib/api-client'

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

jest.mock('@/lib/api-client', () => ({
  tasksClient: { submitHumanVerdict: jest.fn() },
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

beforeEach(() => {
  jest.clearAllMocks()
  mockVerdictParam = null
  submit.mockResolvedValue({
    taskStatus: 'DONE',
    verdict: 'PASS',
    followUpTask: null,
  })
})

describe('TaskVerdictBar', () => {
  it('renders nothing unless the task is IN_REVIEW', () => {
    const { rerender } = render(
      <TaskVerdictBar
        taskId='t-1'
        status='IN_PROGRESS'
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.queryByTestId('task-verdict-bar')).toBeNull()
    rerender(
      <TaskVerdictBar
        taskId='t-1'
        status='DONE'
        onVerdictRecorded={jest.fn()}
      />
    )
    expect(screen.queryByTestId('task-verdict-bar')).toBeNull()
    rerender(
      <TaskVerdictBar
        taskId='t-1'
        status='IN_REVIEW'
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
        onVerdictRecorded={jest.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('verdict-pass'))
    await waitFor(() =>
      expect(screen.getByTestId('verdict-error')).toBeInTheDocument()
    )
  })
})
