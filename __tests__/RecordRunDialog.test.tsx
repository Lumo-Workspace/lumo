/**
 * LUM-801: 记一次执行的对话框。
 *
 * 最要紧的一条：environment **初始不选中**，不选就不让提交。这个 feature 存在
 * 的理由就是分清跑在哪；一旦谁「顺手」给它加个默认值，所有 run 会无差别地记
 * 成 LOCAL，而且没人会注意到。
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: (
        { id, defaultMessage }: { id: string; defaultMessage?: string },
        values?: Record<string, string | number>
      ) => {
        const raw = messages[id] ?? defaultMessage ?? id
        if (!values) return raw
        return Object.entries(values).reduce(
          (acc, [k, v]) =>
            acc.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
          raw
        )
      },
    }),
  }
})

import { RecordRunDialog } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RecordRunDialog'

const testCase = {
  id: 'tc-1',
  taskId: 't-1',
  number: 3,
  title: 'FDIC footer',
  setup: null,
  steps: ['scroll to the bottom', 'assert the footer text'],
  verification: ['refresh the page'],
  expected: 'visible',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
}

const pullRequests = [
  {
    id: 'pr-1',
    number: 123,
    title: 'Fix footer',
    url: 'https://example.com/pr/123',
    state: 'open',
    headSha: 'a1b2c3d4',
    mergeCommitSha: null,
  },
]

const setup = (onSubmit = jest.fn()) => {
  render(
    <RecordRunDialog
      testCase={testCase as never}
      pullRequests={pullRequests}
      onSubmit={onSubmit}
      onClose={() => {}}
    />
  )
  return onSubmit
}

describe('environment has no default', () => {
  it('starts with no environment selected', () => {
    setup()
    const select = screen.getByLabelText(/environment/i) as HTMLSelectElement
    expect(select.value).toBe('')
  })

  it('blocks submit until an environment is chosen', async () => {
    const onSubmit = setup()
    await userEvent.click(screen.getByRole('button', { name: /^record$/i }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/there is no default/i)).toBeInTheDocument()
  })
})

describe('failure locator', () => {
  it('is hidden unless the result is FAIL', async () => {
    setup()
    await userEvent.selectOptions(screen.getByLabelText(/result/i), 'BLOCKED')
    expect(screen.queryByLabelText(/failed at/i)).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText(/result/i), 'FAIL')
    expect(screen.getByLabelText(/failed at/i)).toBeInTheDocument()
  })

  it('lists steps and verification with 1-based labels', async () => {
    setup()
    await userEvent.selectOptions(screen.getByLabelText(/result/i), 'FAIL')
    expect(screen.getByRole('option', { name: /step 1:/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /step 2:/i })).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: /verification 1:/i })
    ).toBeInTheDocument()
  })

  it('submits a 0-based index for the step the user picked', async () => {
    const onSubmit = setup()
    await userEvent.selectOptions(screen.getByLabelText(/result/i), 'FAIL')
    await userEvent.selectOptions(
      screen.getByLabelText(/environment/i),
      'LOCAL'
    )
    await userEvent.selectOptions(
      screen.getByLabelText(/failed at/i),
      'STEPS:1'
    )
    await userEvent.click(screen.getByRole('button', { name: /^record$/i }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'FAIL',
        environment: 'LOCAL',
        failedPhase: 'STEPS',
        failedIndex: 1,
      }),
      []
    )
  })
})

describe('pull request', () => {
  it('starts with no PR selected', () => {
    setup()
    const select = screen.getByLabelText(/pull request/i) as HTMLSelectElement
    expect(select.value).toBe('')
  })

  it('submits the PR number, not its cuid', async () => {
    const onSubmit = setup()
    await userEvent.selectOptions(
      screen.getByLabelText(/environment/i),
      'PREVIEW'
    )
    await userEvent.selectOptions(screen.getByLabelText(/pull request/i), '123')
    await userEvent.click(screen.getByRole('button', { name: /^record$/i }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ pullRequestNumber: 123 }),
      []
    )
  })

  it('never claims a clean worktree — commitDirty stays null from the web', async () => {
    const onSubmit = setup()
    await userEvent.selectOptions(
      screen.getByLabelText(/environment/i),
      'LOCAL'
    )
    await userEvent.click(screen.getByRole('button', { name: /^record$/i }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ commitDirty: null }),
      []
    )
  })
})
