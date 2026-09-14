/** @jest-environment jsdom */

const en: Record<string, string> = {
  'milestone.field.state': 'State',
  'milestone.field.startDate': 'Start date',
  'milestone.field.targetDate': 'Target date',
  'milestone.state.active': 'Active',
  'milestone.state.completed': 'Completed',
  'milestone.state.archived': 'Archived',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { MilestoneSidebar } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneSidebar'

function setup(
  overrides: Partial<React.ComponentProps<typeof MilestoneSidebar>> = {}
) {
  const onUpdate = jest.fn()
  render(
    <MilestoneSidebar
      state='active'
      startDate='2026-06-01T00:00:00.000Z'
      targetDate='2026-08-31T00:00:00.000Z'
      archived={false}
      onUpdate={onUpdate}
      {...overrides}
    />
  )
  return { onUpdate }
}

// LUM-714: the rail lost its status control. State is derived (completedAt /
// archivedAt), so the only thing left to render is a read-out — there must be
// no way to *set* it from here.
test('state renders as a read-out, with no control to change it', () => {
  setup()
  expect(screen.getByText('State')).toBeInTheDocument()
  expect(screen.getByText('Active')).toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.queryByTestId('status-select')).not.toBeInTheDocument()
})

test('a completed milestone reads "Completed"', () => {
  setup({ state: 'completed' })
  expect(screen.getByText('Completed')).toBeInTheDocument()
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

test('archived disables the date controls', () => {
  setup({ archived: true, state: 'archived' })
  expect(
    (screen.getByLabelText('Start date') as HTMLInputElement).disabled
  ).toBe(true)
  expect(
    (screen.getByLabelText('Target date') as HTMLInputElement).disabled
  ).toBe(true)
})
