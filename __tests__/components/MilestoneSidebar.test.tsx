/** @jest-environment jsdom */

const en: Record<string, string> = {
  'milestone.field.status': 'Status',
  'milestone.field.startDate': 'Start date',
  'milestone.field.targetDate': 'Target date',
  'milestone.status.ACTIVE': 'Active',
  'milestone.status.PLANNED': 'Planned',
  'milestone.status.COMPLETED': 'Completed',
  'milestone.status.CANCELLED': 'Cancelled',
  'milestone.archived': 'Archived',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

// Radix Select can't open in jsdom — render a native <select> so onValueChange
// fires on change and we can assert the callback payload.
jest.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children: _children,
    disabled,
  }: {
    value: string
    onValueChange: (v: string) => void
    children: React.ReactNode
    disabled?: boolean
  }) => (
    <input
      type='text'
      data-testid='status-select'
      value={value}
      disabled={disabled}
      onChange={e => onValueChange(e.target.value)}
    />
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { MilestoneSidebar } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneSidebar'

function setup(overrides: Partial<React.ComponentProps<typeof MilestoneSidebar>> = {}) {
  const onUpdate = jest.fn()
  render(
    <MilestoneSidebar
      status='ACTIVE'
      startDate='2026-06-01T00:00:00.000Z'
      targetDate='2026-08-31T00:00:00.000Z'
      archived={false}
      onUpdate={onUpdate}
      {...overrides}
    />
  )
  return { onUpdate }
}

test('changing status calls onUpdate with { status }', () => {
  const { onUpdate } = setup()
  fireEvent.change(screen.getByTestId('status-select'), {
    target: { value: 'COMPLETED' },
  })
  expect(onUpdate).toHaveBeenCalledWith({ status: 'COMPLETED' })
})

test('editing start date calls onUpdate with { startDate }', () => {
  const { onUpdate } = setup()
  fireEvent.change(screen.getByLabelText('Start date'), {
    target: { value: '2026-07-01' },
  })
  expect(onUpdate).toHaveBeenCalledWith({ startDate: '2026-07-01' })
})

test('clearing target date calls onUpdate with { targetDate: null }', () => {
  const { onUpdate } = setup()
  fireEvent.change(screen.getByLabelText('Target date'), {
    target: { value: '' },
  })
  expect(onUpdate).toHaveBeenCalledWith({ targetDate: null })
})

test('date inputs prefill from ISO values (sliced to yyyy-mm-dd)', () => {
  setup()
  expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe(
    '2026-06-01'
  )
  expect((screen.getByLabelText('Target date') as HTMLInputElement).value).toBe(
    '2026-08-31'
  )
})

test('archived disables the controls', () => {
  setup({ archived: true })
  expect((screen.getByTestId('status-select') as HTMLSelectElement).disabled).toBe(true)
  expect((screen.getByLabelText('Start date') as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByLabelText('Target date') as HTMLInputElement).disabled).toBe(true)
})
