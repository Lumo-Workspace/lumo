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
