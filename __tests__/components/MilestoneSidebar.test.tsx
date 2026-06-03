/** @jest-environment jsdom */

const en: Record<string, string> = {
  'milestone.field.status': 'Status',
  'milestone.field.targetDate': 'Target date',
  'milestone.field.description': 'Description',
  'milestone.status.ACTIVE': 'Active',
  'milestone.status.PLANNED': 'Planned',
  'milestone.archived': 'Archived',
  'milestone.targetDate.none': 'No target date',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useFormatDate', () => ({
  useFormatDate: () => ({ fmtDate: (d: string) => `D(${d})` }),
}))

import { render, screen } from '@testing-library/react'
import { MilestoneSidebar } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneSidebar'

test('renders status, date range and description', () => {
  render(
    <MilestoneSidebar
      status='ACTIVE'
      startDate='2026-06-01T00:00:00.000Z'
      targetDate='2026-08-31T00:00:00.000Z'
      description='Ship the thing'
      archived={false}
    />
  )
  expect(screen.getByText('Active')).toBeTruthy()
  expect(screen.getByText('Ship the thing')).toBeTruthy()
  expect(screen.getByText(/D\(2026-06-01/)).toBeTruthy()
  expect(screen.getByText(/D\(2026-08-31/)).toBeTruthy()
})

test('shows archived badge and target-date fallback, no description block', () => {
  render(
    <MilestoneSidebar
      status='PLANNED'
      startDate={null}
      targetDate={null}
      description={null}
      archived={true}
    />
  )
  expect(screen.getByText('Archived')).toBeTruthy()
  expect(screen.getByText('No target date')).toBeTruthy()
  expect(screen.queryByText('Description')).toBeNull()
})
