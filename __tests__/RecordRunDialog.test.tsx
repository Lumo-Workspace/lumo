/**
 * LUM-801: 记一次执行的对话框。
 *
 * 最要紧的一条：environment **初始不选中**，不选就不让提交。这个 feature 存在
 * 的理由就是分清跑在哪；一旦谁「顺手」给它加个默认值，所有 run 会无差别地记
 * 成 LOCAL，而且没人会注意到。
 */
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installRadixSelectShims, pickOption } from './helpers/radix-select'

installRadixSelectShims()

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
    // LUM-1265: Radix Select shows its placeholder while the value is ''.
    expect(screen.getByLabelText(/environment/i)).toHaveTextContent(
      'Choose the environment…'
    )
  })

  it('blocks submit until an environment is chosen', async () => {
    const onSubmit = setup()
    await userEvent.click(screen.getByRole('button', { name: /^record$/i }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/there is no default/i)).toBeInTheDocument()
  })
})

const markRest = () =>
  userEvent.click(screen.getByRole('button', { name: 'Mark the rest passed' }))

describe('per-step picker', () => {
  it('is hidden unless the result is PASS or FAIL', async () => {
    setup()
    expect(screen.getByText('Result of each step')).toBeInTheDocument()
    await pickOption(screen.getByLabelText(/result/i), 'Blocked')
    expect(screen.queryByText('Result of each step')).not.toBeInTheDocument()
  })

  it('lists steps and verification with 1-based labels', async () => {
    setup()
    expect(screen.getByText('1. scroll to the bottom')).toBeInTheDocument()
    expect(screen.getByText('2. assert the footer text')).toBeInTheDocument()
    expect(
      screen.getByText('Verification 1: refresh the page')
    ).toBeInTheDocument()
  })

  it('refuses to submit until every step is marked, naming what is missing', async () => {
    const onSubmit = setup()
    await pickOption(screen.getByLabelText(/environment/i), 'Local')
    await userEvent.click(screen.getByRole('button', { name: /^record$/i }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(
      screen.getByText('Mark every step first: s1, s2, v1')
    ).toBeInTheDocument()
  })

  it('refuses a skip without a reason', async () => {
    const onSubmit = setup()
    await pickOption(screen.getByLabelText(/environment/i), 'Local')
    await markRest()
    await userEvent.click(screen.getAllByRole('radio', { name: 'Skipped' })[0]!)
    await userEvent.click(screen.getByRole('button', { name: /^record$/i }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Mark every step first: s1')).toBeInTheDocument()
  })

  it('submits every step, a skip carrying its reason', async () => {
    const onSubmit = setup()
    await pickOption(screen.getByLabelText(/environment/i), 'Local')
    await markRest()
    await userEvent.click(screen.getAllByRole('radio', { name: 'Skipped' })[2]!)
    await userEvent.type(
      screen.getByPlaceholderText('Why was it skipped?'),
      'no browser'
    )
    await userEvent.click(screen.getByRole('button', { name: /^record$/i }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'PASS',
        failedPhase: null,
        failedIndex: null,
        unprovenVerification: [],
        stepResults: [
          { phase: 'STEPS', index: 0, status: 'PASS' },
          { phase: 'STEPS', index: 1, status: 'PASS' },
          {
            phase: 'VERIFICATION',
            index: 0,
            status: 'SKIP',
            reason: 'no browser',
          },
        ],
      }),
      []
    )
  })

  it('refuses to submit a FAIL with no cause picked', async () => {
    const onSubmit = setup()
    await pickOption(screen.getByLabelText(/result/i), 'Fail')
    await pickOption(screen.getByLabelText(/environment/i), 'Local')
    await userEvent.click(screen.getByRole('button', { name: /^record$/i }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('a FAIL needs a step marked failed', async () => {
    const onSubmit = setup()
    await pickOption(screen.getByLabelText(/result/i), 'Fail')
    await pickOption(screen.getByLabelText(/environment/i), 'Local')
    await pickOption(screen.getByLabelText(/whose fault/i), 'Could not tell')
    await markRest()
    await userEvent.click(screen.getByRole('button', { name: /^record$/i }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        'A failed run needs the step it failed at marked as failed.'
      )
    ).toBeInTheDocument()
  })

  it('submits the steps up to the one marked failed', async () => {
    const onSubmit = setup()
    await pickOption(screen.getByLabelText(/result/i), 'Fail')
    await pickOption(screen.getByLabelText(/environment/i), 'Local')
    // LUM-808: 一条 FAIL 必须说清是谁的锅；选举证责任最轻的那个。
    await pickOption(screen.getByLabelText(/whose fault/i), 'Could not tell')
    await userEvent.click(screen.getAllByRole('radio', { name: 'Passed' })[0]!)
    await userEvent.click(screen.getAllByRole('radio', { name: 'Failed' })[1]!)
    await userEvent.click(screen.getByRole('button', { name: /^record$/i }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'FAIL',
        environment: 'LOCAL',
        stepResults: [
          { phase: 'STEPS', index: 0, status: 'PASS' },
          { phase: 'STEPS', index: 1, status: 'FAIL' },
        ],
      }),
      []
    )
  })
})

describe('evidence file guards', () => {
  // 浏览器补验时抓到的（LUM-801）：两种违规原本共用静态提示那一句，用户看到
  // 同一句话一灰一红出现两次，既不知道违的是「太多」还是「太大」，也不知道
  // 自己的实际值；而且被拒时原生 input 仍显示已选中，组件其实一个都没收。
  const fileInput = () =>
    document.querySelector('input[type="file"]') as HTMLInputElement

  // jsdom 没有 DataTransfer，直接把 FileList 形状定义上去。
  // 注意：jsdom 按规范禁止给 file input 的 value 赋非空值，所以「被拒时清空
  // 原生 input」这件事没法直接断言 —— 改为断言它真正的后果：被拒的文件不会
  // 被偷偷提交上去（见下面的 onSubmit 断言）。
  function attach(files: File[]) {
    const input = fileInput()
    const list = {
      ...files,
      length: files.length,
      item: (i: number) => files[i] ?? null,
      [Symbol.iterator]: function* () {
        yield* files
      },
    } as unknown as FileList
    Object.defineProperty(input, 'files', {
      value: list,
      configurable: true,
      writable: true,
    })
    fireEvent.change(input)
    return input
  }

  const sixFiles = () =>
    Array.from(
      { length: 6 },
      (_, i) => new File(['x'], `p${i}.txt`, { type: 'text/plain' })
    )

  it('names the actual count when too many files are picked', () => {
    setup()
    attach(sixFiles())
    expect(screen.getByText(/you picked 6 files/i)).toBeInTheDocument()
  })

  it('names the offending file and its size when one is too large', () => {
    setup()
    attach([
      new File([new Uint8Array(11 * 1024 * 1024)], 'huge.txt', {
        type: 'text/plain',
      }),
    ])
    expect(screen.getByText(/huge\.txt/)).toBeInTheDocument()
    expect(screen.getByText(/11\.0 MB/)).toBeInTheDocument()
  })

  it('does not reuse the static hint text as the error', () => {
    setup()
    attach(sixFiles())
    // 提示仍在（它是说明），但错误不能是同一句话
    const hint = screen.getByText(/up to 10 MB each, 5 files max/i)
    const error = screen.getByText(/you picked 6 files/i)
    expect(hint).not.toBe(error)
    expect(error.textContent).not.toEqual(hint.textContent)
  })

  it('never submits files it rejected', async () => {
    const onSubmit = setup()
    attach(sixFiles())
    await pickOption(screen.getByLabelText(/environment/i), 'Local')
    await markRest()
    await userEvent.click(screen.getByRole('button', { name: /^record$/i }))
    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), [])
  })

  it('accepts a valid selection and clears a previous error', () => {
    setup()
    attach(sixFiles())
    expect(screen.getByText(/you picked 6 files/i)).toBeInTheDocument()

    attach([new File(['ok'], 'fine.txt', { type: 'text/plain' })])
    expect(screen.queryByText(/you picked/i)).not.toBeInTheDocument()
  })
})

describe('pull request', () => {
  it('starts with no PR selected', () => {
    setup()
    expect(screen.getByLabelText(/pull request/i)).toHaveTextContent(
      'Not tied to a PR'
    )
  })

  it('submits the PR number, not its cuid', async () => {
    const onSubmit = setup()
    await pickOption(screen.getByLabelText(/environment/i), 'Preview')
    await pickOption(screen.getByLabelText(/pull request/i), /#123/)
    await markRest()
    await userEvent.click(screen.getByRole('button', { name: /^record$/i }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ pullRequestNumber: 123 }),
      []
    )
  })

  it('never claims a clean worktree — commitDirty stays null from the web', async () => {
    const onSubmit = setup()
    await pickOption(screen.getByLabelText(/environment/i), 'Local')
    await markRest()
    await userEvent.click(screen.getByRole('button', { name: /^record$/i }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ commitDirty: null }),
      []
    )
  })
})
