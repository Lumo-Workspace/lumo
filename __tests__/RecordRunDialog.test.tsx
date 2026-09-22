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

  it('refuses to submit a FAIL with no cause picked', async () => {
    const onSubmit = setup()
    await userEvent.selectOptions(screen.getByLabelText(/result/i), 'FAIL')
    await userEvent.selectOptions(
      screen.getByLabelText(/environment/i),
      'LOCAL'
    )
    await userEvent.click(screen.getByRole('button', { name: /^record$/i }))
    expect(onSubmit).not.toHaveBeenCalled()
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
    // LUM-808: 一条 FAIL 现在必须说清是谁的锅。这条测的是定位换算，
    // 选举证责任最轻的那一个。
    await userEvent.selectOptions(
      screen.getByLabelText(/whose fault/i),
      'UNKNOWN'
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
    await userEvent.selectOptions(
      screen.getByLabelText(/environment/i),
      'LOCAL'
    )
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
