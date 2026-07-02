/** @jest-environment jsdom */

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { MilestoneOverviewTab } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneOverviewTab'

function setup(name = 'Beta release', archived = false) {
  const onUpdate = jest.fn()
  render(
    <MilestoneOverviewTab
      milestone={{
        id: 'm1',
        name,
        startDate: null,
        targetDate: null,
      }}
      onUpdate={onUpdate}
      workspaceUrl='acme'
      archived={archived}
    />
  )
  return { onUpdate }
}

test('renders the milestone name in the hero', () => {
  setup()
  expect(screen.getByText('Beta release')).toBeTruthy()
})

test('renaming via hero title blur calls onUpdate with trimmed { name }', () => {
  const { onUpdate } = setup()
  const title = screen.getByText('Beta release')
  title.textContent = '  Gamma  '
  fireEvent.blur(title)
  expect(onUpdate).toHaveBeenCalledWith({ name: 'Gamma' })
})

test('blurring an unchanged title does not call onUpdate', () => {
  const { onUpdate } = setup()
  const title = screen.getByText('Beta release')
  fireEvent.blur(title)
  expect(onUpdate).not.toHaveBeenCalled()
})

test('archived milestone does not commit name edits', () => {
  const { onUpdate } = setup('Beta release', true)
  const title = screen.getByText('Beta release')
  title.textContent = 'Gamma'
  fireEvent.blur(title)
  expect(onUpdate).not.toHaveBeenCalled()
})
