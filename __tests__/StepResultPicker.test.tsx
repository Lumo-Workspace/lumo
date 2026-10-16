/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

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

import { StepResultPicker } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/StepResultPicker'

it('"mark the rest passed" fills only unmarked items', () => {
  const onChange = jest.fn()
  render(
    <StepResultPicker
      steps={['a', 'b']}
      verification={['v']}
      result='PASS'
      value={{ 'STEPS:1': { status: 'SKIP', reason: 'no DB' } }}
      onChange={onChange}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Mark the rest passed' }))
  expect(onChange).toHaveBeenCalledWith({
    'STEPS:0': { status: 'PASS', reason: '' },
    'STEPS:1': { status: 'SKIP', reason: 'no DB' },
    'VERIFICATION:0': { status: 'PASS', reason: '' },
  })
})

it('shows a reason box only for a skipped step', () => {
  render(
    <StepResultPicker
      steps={['a', 'b']}
      verification={[]}
      result='PASS'
      value={{ 'STEPS:1': { status: 'SKIP', reason: '' } }}
      onChange={jest.fn()}
    />
  )
  expect(screen.getAllByPlaceholderText('Why was it skipped?')).toHaveLength(1)
})

it('offers Failed only on a FAIL run', () => {
  const { rerender } = render(
    <StepResultPicker
      steps={['a']}
      verification={[]}
      result='PASS'
      value={{}}
      onChange={jest.fn()}
    />
  )
  expect(screen.queryByRole('radio', { name: /Failed/ })).toBeNull()
  rerender(
    <StepResultPicker
      steps={['a']}
      verification={[]}
      result='FAIL'
      value={{}}
      onChange={jest.fn()}
    />
  )
  expect(screen.getByRole('radio', { name: /Failed/ })).toBeInTheDocument()
})

// LUM-1185: radio 的 name 曾是裸的 `STEPS:0`。同一页面两个选择器时浏览器把它们
// 当成一组，后一个抢走前一个的选中——静态截图里英文面板「没选中却能挂文件」的根因。
it('keeps two pickers on one page from sharing radio groups', () => {
  const marked = {
    'STEPS:0': { status: 'PASS' as const, reason: '' },
  }
  render(
    <>
      <StepResultPicker
        steps={['a']}
        verification={[]}
        result='PASS'
        value={marked}
        onChange={jest.fn()}
      />
      <StepResultPicker
        steps={['a']}
        verification={[]}
        result='PASS'
        value={marked}
        onChange={jest.fn()}
      />
    </>
  )
  const passed = screen.getAllByRole('radio', {
    name: 'Passed',
  }) as HTMLInputElement[]
  expect(passed).toHaveLength(2)
  expect(passed[0]!.name).not.toBe(passed[1]!.name)
  expect(passed.map(r => r.checked)).toEqual([true, true])
})

it('shows a step whose status this result cannot pick as unmarked', () => {
  const renderMarkedStep = jest.fn(() => <span>extra</span>)
  render(
    <StepResultPicker
      steps={['a']}
      verification={[]}
      result='PASS'
      value={{ 'STEPS:0': { status: 'FAIL', reason: '' } }}
      onChange={jest.fn()}
      renderMarkedStep={renderMarkedStep}
    />
  )
  expect(
    (screen.getAllByRole('radio') as HTMLInputElement[]).some(r => r.checked)
  ).toBe(false)
  expect(screen.queryByRole('button', { name: /Clear the result/ })).toBeNull()
  expect(renderMarkedStep).not.toHaveBeenCalled()
})
