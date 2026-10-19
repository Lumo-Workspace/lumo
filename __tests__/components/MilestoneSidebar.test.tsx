/** @jest-environment jsdom */

const en: Record<string, string> = {
  'milestone.field.state': 'State',
  'milestone.field.startDate': 'Start date',
  'milestone.field.targetDate': 'Target date',
  'milestone.state.active': 'Active',
  'milestone.state.completed': 'Completed',
  'milestone.state.archived': 'Archived',
  'milestone.hero.notSet': 'Not set',
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

/** Open the shared calendar picker behind `trigger` and click `day` (a
 *  local-midnight Date, which is what the calendar itself hands back). */
function pickDay(trigger: HTMLElement, day: Date) {
  fireEvent.click(trigger)
  const cell = document.querySelector(
    `button[data-day="${day.toLocaleDateString()}"]`
  )
  if (!cell) throw new Error(`no calendar cell for ${day.toDateString()}`)
  fireEvent.click(cell)
}

test('picking a start date calls onUpdate with the calendar day { startDate }', () => {
  const { onUpdate } = setup()
  // The calendar opens on the current value's month (June 2026).
  pickDay(screen.getByLabelText('Start date'), new Date(2026, 5, 17))
  expect(onUpdate).toHaveBeenCalledWith({ startDate: '2026-06-17' })
})

test('clicking the picked target day again clears it: { targetDate: null }', () => {
  const { onUpdate } = setup()
  pickDay(screen.getByLabelText('Target date'), new Date(2026, 7, 31))
  expect(onUpdate).toHaveBeenCalledWith({ targetDate: null })
})

test('date pickers show the stored calendar day and mark it selected', () => {
  setup()
  expect(screen.getByLabelText('Start date')).toHaveTextContent('Jun 1, 2026')
  expect(screen.getByLabelText('Target date')).toHaveTextContent('Aug 31, 2026')
  fireEvent.click(screen.getByLabelText('Start date'))
  const selected = document.querySelector('button[data-selected-single="true"]')
  expect(selected).toHaveAttribute(
    'data-day',
    new Date(2026, 5, 1).toLocaleDateString()
  )
})

test('an empty date shows the placeholder', () => {
  setup({ targetDate: null })
  expect(screen.getByLabelText('Target date')).toHaveTextContent('Not set')
})

test('archived disables the date controls', () => {
  setup({ archived: true, state: 'archived' })
  expect(screen.getByLabelText('Start date')).toBeDisabled()
  expect(screen.getByLabelText('Target date')).toBeDisabled()
})
