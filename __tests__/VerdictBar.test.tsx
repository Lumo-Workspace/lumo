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

const submit = tasksClient.submitHumanVerdict as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  submit.mockResolvedValue({
    taskStatus: 'DONE',
    verdict: 'PASS',
    followUpTask: null,
  })
})

describe('TaskVerdictBar', () => {
  it('renders nothing unless the task is IN_REVIEW', () => {
    const { rerender } = render(
      <TaskVerdictBar taskId='t-1' status='IN_PROGRESS' onVerdictRecorded={jest.fn()} />
    )
    expect(screen.queryByTestId('task-verdict-bar')).toBeNull()

    rerender(
      <TaskVerdictBar taskId='t-1' status='DONE' onVerdictRecorded={jest.fn()} />
    )
    expect(screen.queryByTestId('task-verdict-bar')).toBeNull()

    rerender(
      <TaskVerdictBar taskId='t-1' status='IN_REVIEW' onVerdictRecorded={jest.fn()} />
    )
    expect(screen.getByTestId('task-verdict-bar')).toBeInTheDocument()
    expect(screen.getByTestId('verdict-pass')).toBeInTheDocument()
    expect(screen.getByTestId('verdict-followup')).toBeInTheDocument()
    expect(screen.getByTestId('verdict-fail')).toBeInTheDocument()
  })

  it('PASS posts to the human-verdict endpoint and reports the new status', async () => {
    const onRecorded = jest.fn()
    render(
      <TaskVerdictBar taskId='t-1' status='IN_REVIEW' onVerdictRecorded={onRecorded} />
    )
    fireEvent.click(screen.getByTestId('verdict-pass'))
    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    expect(submit).toHaveBeenCalledWith('t-1', { verdict: 'PASS' })
    expect(onRecorded).toHaveBeenCalledWith(
      expect.objectContaining({ taskStatus: 'DONE' })
    )
  })

  it('FAIL requires picking a rejection reason before it can submit', async () => {
    submit.mockResolvedValue({
      taskStatus: 'IN_PROGRESS',
      verdict: 'FAIL',
      followUpTask: null,
    })
    render(
      <TaskVerdictBar taskId='t-1' status='IN_REVIEW' onVerdictRecorded={jest.fn()} />
    )
    fireEvent.click(screen.getByTestId('verdict-fail'))
    const confirm = screen.getByTestId('verdict-confirm')
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByTestId('verdict-reason-select'), {
      target: { value: 'SCOPE_MISMATCH' },
    })
    expect(confirm).not.toBeDisabled()

    fireEvent.change(screen.getByTestId('verdict-note'), {
      target: { value: 'not what we agreed' },
    })
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith('t-1', {
        verdict: 'FAIL',
        rejectionReasonEnum: 'SCOPE_MISMATCH',
        note: 'not what we agreed',
      })
    )
  })

  it('PASS_WITH_FOLLOWUP submits with the outstanding-items note and no reason enum', async () => {
    submit.mockResolvedValue({
      taskStatus: 'DONE',
      verdict: 'PASS_WITH_FOLLOWUP',
      followUpTask: { id: 't-fu', number: 43, title: 'follow-up: x' },
    })
    render(
      <TaskVerdictBar taskId='t-1' status='IN_REVIEW' onVerdictRecorded={jest.fn()} />
    )
    fireEvent.click(screen.getByTestId('verdict-followup'))
    // No reason picker on the follow-up panel; confirm is enabled right away.
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

  it('shows an inline error when the endpoint rejects', async () => {
    submit.mockRejectedValue(new Error('403'))
    render(
      <TaskVerdictBar taskId='t-1' status='IN_REVIEW' onVerdictRecorded={jest.fn()} />
    )
    fireEvent.click(screen.getByTestId('verdict-pass'))
    await waitFor(() =>
      expect(screen.getByTestId('verdict-error')).toBeInTheDocument()
    )
  })
})
