/** @jest-environment jsdom */

const en: Record<string, string> = {
  'milestone.hero.setDate': 'Set date',
  'milestone.hero.notSet': 'Not set',
  'milestone.field.targetDate': 'Target date',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useFormatDate', () => ({
  useFormatDate: () => ({ fmtDate: (d: string) => d }),
}))

import { fireEvent, render, screen } from '@testing-library/react'
import { MilestoneHero } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneHero'

function renderHero(onUpdate = jest.fn()) {
  render(
    <MilestoneHero
      name='Q3'
      taskCounts={null}
      health={null}
      startDate={null}
      derivedStartDate={null}
      targetDate={null}
      onUpdate={onUpdate}
    />
  )
  return onUpdate
}

// LUM-1270: "Set date" opens the shared calendar picker (it used to poke a
// hidden native date input), and saves the clicked calendar day.
test('"Set date" opens the calendar and saves the picked day as targetDate', () => {
  const onUpdate = renderHero()
  fireEvent.click(screen.getByRole('button', { name: 'Set date' }))
  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), 12)
  const cell = document.querySelector(
    `button[data-day="${day.toLocaleDateString()}"]`
  )
  expect(cell).not.toBeNull()
  fireEvent.click(cell!)
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-12`
  expect(onUpdate).toHaveBeenCalledWith({ targetDate: key })
})

test('no native date input is rendered', () => {
  renderHero()
  expect(document.querySelector('input[type="date"]')).toBeNull()
})
