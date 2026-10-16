/** @jest-environment jsdom */
/**
 * LUM-1185: 记录弹窗里给某一步挂证据文件。
 * - 只有标了结果的步骤有上传入口；
 * - 整次 + 按步合计最多 5 个；
 * - 清除一步的结果时，它下面的文件一并清掉（裁定见 lumo task decide）；
 * - 提交出的 payload 走 CLI 同一契约，记下后逐步报告把文件画在那一步下面。
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
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
        { id }: { id: string },
        values?: Record<string, string | number>
      ) =>
        Object.entries(values ?? {}).reduce(
          (acc, [k, v]) => acc.split(`{${k}}`).join(String(v)),
          messages[id] ?? id
        ),
    }),
  }
})

import { RecordRunDialog } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RecordRunDialog'
import { TestCaseRunReport } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TestCaseRunReport'
import { recordRunBodySchema } from '@/lib/validation/test-case'

const testCase = {
  id: 'tc-1',
  taskId: 't-1',
  number: 3,
  title: 'Refund',
  setup: null,
  steps: ['open invoice', 'click Refund'],
  verification: ['banner says Refunded'],
  expected: 'Refunded',
  createdAt: new Date('2026-10-01'),
  updatedAt: new Date('2026-10-01'),
  deletedAt: null,
}

const setup = () => {
  const onSubmit = jest.fn()
  render(
    <RecordRunDialog
      testCase={testCase as never}
      pullRequests={[]}
      onSubmit={onSubmit}
      onClose={() => {}}
    />
  )
  return onSubmit
}

const png = (name: string) => new File(['img'], name, { type: 'image/png' })

const stepInput = (ref: string) =>
  screen.queryByLabelText(
    `Attach files to step ${ref}`
  ) as HTMLInputElement | null

/** jsdom 没有 DataTransfer：直接把 FileList 形状定义到 input 上。 */
function attach(input: HTMLInputElement, files: File[]) {
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
}

const runInput = () =>
  screen.getByLabelText(/^Evidence files/) as HTMLInputElement

const chooseEnv = () =>
  userEvent.selectOptions(screen.getByLabelText(/environment/i), 'LOCAL')
const markRest = () =>
  userEvent.click(screen.getByRole('button', { name: 'Mark the rest passed' }))
const record = () =>
  userEvent.click(screen.getByRole('button', { name: /^record$/i }))

describe('per-step evidence in the record dialog', () => {
  it('offers no upload on a step without a result', async () => {
    setup()
    expect(stepInput('s1')).toBeNull()
    expect(stepInput('s2')).toBeNull()
    await userEvent.click(screen.getAllByRole('radio', { name: 'Passed' })[0]!)
    expect(stepInput('s1')).not.toBeNull()
    expect(stepInput('s2')).toBeNull()
    expect(stepInput('v1')).toBeNull()
  })

  it('submits the file under its step, after the whole-run files', async () => {
    const onSubmit = setup()
    await chooseEnv()
    await markRest()
    attach(runInput(), [png('whole.png')])
    attach(stepInput('s2')!, [png('s2.png')])
    expect(screen.getByText('s2.png')).toBeInTheDocument()
    await record()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const [body, files] = onSubmit.mock.calls[0] as [
      Record<string, unknown>,
      File[],
    ]
    expect(files.map(f => f.name)).toEqual(['whole.png', 's2.png'])
    expect(body.evidence).toEqual([])
    expect(body.stepResults).toEqual([
      { phase: 'STEPS', index: 0, status: 'PASS' },
      { phase: 'STEPS', index: 1, status: 'PASS', evidence: [1] },
      { phase: 'VERIFICATION', index: 0, status: 'PASS' },
    ])
  })

  it('refuses a sixth file across the run and its steps, naming the total', async () => {
    const onSubmit = setup()
    await chooseEnv()
    await markRest()
    attach(runInput(), [png('a.png'), png('b.png'), png('c.png')])
    attach(stepInput('s1')!, [png('d.png'), png('e.png')])
    attach(stepInput('v1')!, [png('f.png')])
    expect(
      screen.getByText(
        'That makes 6 files for this run, counting files attached to steps — at most 5.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText('f.png')).not.toBeInTheDocument()
    await record()
    const [, files] = onSubmit.mock.calls[0] as [unknown, File[]]
    expect(files).toHaveLength(5)
  })

  it('refuses whole-run files that overflow what the steps already hold', async () => {
    setup()
    await markRest()
    attach(stepInput('s1')!, [png('d.png'), png('e.png')])
    attach(runInput(), [png('a.png'), png('b.png'), png('c.png'), png('x.png')])
    expect(
      screen.getByText(
        'That makes 6 files for this run, counting files attached to steps — at most 5.'
      )
    ).toBeInTheDocument()
  })

  it('refuses a type the upload route would reject', async () => {
    setup()
    await markRest()
    attach(stepInput('s1')!, [
      new File(['%PDF'], 'spec.pdf', { type: 'application/pdf' }),
    ])
    expect(
      screen.getByText(/“spec\.pdf” is not a supported type/)
    ).toBeInTheDocument()
    expect(screen.queryByText('spec.pdf')).not.toBeInTheDocument()
  })

  it('drops a step’s files when its result is cleared', async () => {
    const onSubmit = setup()
    await chooseEnv()
    await markRest()
    attach(stepInput('s2')!, [png('s2.png')])
    expect(screen.getByText('s2.png')).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Clear the result of 2. click Refund',
      })
    )
    expect(screen.queryByText('s2.png')).not.toBeInTheDocument()
    expect(stepInput('s2')).toBeNull()

    // 重新标上：文件不会回来。
    await userEvent.click(screen.getAllByRole('radio', { name: 'Passed' })[1]!)
    expect(screen.queryByText('s2.png')).not.toBeInTheDocument()
    await record()
    const [body, files] = onSubmit.mock.calls[0] as [
      Record<string, unknown>,
      File[],
    ]
    expect(files).toEqual([])
    expect(body.stepResults).toEqual([
      { phase: 'STEPS', index: 0, status: 'PASS' },
      { phase: 'STEPS', index: 1, status: 'PASS' },
      { phase: 'VERIFICATION', index: 0, status: 'PASS' },
    ])
  })

  it('drops step files when the run turns BLOCKED', async () => {
    const onSubmit = setup()
    await chooseEnv()
    await markRest()
    attach(stepInput('s1')!, [png('s1.png')])
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Result' }),
      'BLOCKED'
    )
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Result' }),
      'PASS'
    )
    expect(screen.queryByText('s1.png')).not.toBeInTheDocument()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Result' }),
      'BLOCKED'
    )
    await record()
    const [, files] = onSubmit.mock.calls[0] as [unknown, File[]]
    expect(files).toEqual([])
  })

  it('lets one attached file be removed', async () => {
    setup()
    await markRest()
    attach(stepInput('s1')!, [png('keep.png'), png('drop.png')])
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove drop.png' })
    )
    expect(screen.getByText('keep.png')).toBeInTheDocument()
    expect(screen.queryByText('drop.png')).not.toBeInTheDocument()
  })

  it('counts step files as evidence for an implementation defect', async () => {
    const onSubmit = setup()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Result' }),
      'FAIL'
    )
    await chooseEnv()
    await userEvent.selectOptions(
      screen.getByLabelText(/whose fault/i),
      'IMPLEMENTATION_DEFECT'
    )
    await userEvent.click(screen.getAllByRole('radio', { name: 'Passed' })[0]!)
    await userEvent.click(screen.getAllByRole('radio', { name: 'Failed' })[1]!)
    attach(stepInput('s2')!, [png('broken.png')])
    await record()
    const [body, files] = onSubmit.mock.calls[0] as [
      Record<string, unknown>,
      File[],
    ]
    expect(files.map(f => f.name)).toEqual(['broken.png'])
    expect(body.stepResults).toEqual([
      { phase: 'STEPS', index: 0, status: 'PASS' },
      { phase: 'STEPS', index: 1, status: 'FAIL', evidence: [0] },
    ])
  })
})

describe('after recording', () => {
  it('the run report draws the file under its step', async () => {
    const onSubmit = setup()
    await chooseEnv()
    await markRest()
    attach(stepInput('s2')!, [png('s2.png')])
    await record()
    const [body, files] = onSubmit.mock.calls[0] as [
      Record<string, unknown>,
      File[],
    ]

    // 与 useTestCases.recordRun 相同的拼法：上传结果接在 body.evidence 之后。
    const uploaded = files.map(f => ({
      type: 'file' as const,
      url: `https://blob.example/${f.name}`,
      filename: f.name,
      contentType: f.type,
      size: f.size,
    }))
    const parsed = recordRunBodySchema.parse({
      ...body,
      evidence: [...(body.evidence as unknown[]), ...uploaded],
    })
    const stored = (parsed.stepResults ?? []).map(r => ({
      ...r,
      text:
        r.phase === 'STEPS'
          ? testCase.steps[r.index]
          : testCase.verification[r.index],
      reason: r.reason ?? null,
      durationMs: r.durationMs ?? null,
      evidence: r.evidence ?? [],
    }))

    render(
      <TestCaseRunReport
        run={
          {
            id: 'run-1',
            testCaseId: 'tc-1',
            taskId: 't-1',
            result: 'PASS',
            environment: 'LOCAL',
            failedPhase: null,
            failedIndex: null,
            failedStepText: null,
            failureAttribution: null,
            unprovenVerification: [],
            stepResults: stored,
            actual: null,
            evidence: parsed.evidence,
            note: null,
            pullRequestId: null,
            commitSha: null,
            commitDirty: null,
            executedByMemberId: null,
            sourceSessionId: null,
            createdAt: new Date('2026-10-17'),
            disposition: null,
          } as never
        }
        steps={testCase.steps}
        verification={testCase.verification}
        expected={testCase.expected}
        requiredEnvironment={null}
        pullRequests={[]}
      />
    )
    const rows = screen.getAllByTestId('step-row')
    expect(within(rows[1]!).getByRole('img')).toHaveAttribute(
      'src',
      'https://blob.example/s2.png'
    )
    expect(within(rows[0]!).queryByRole('img')).toBeNull()
  })
})
