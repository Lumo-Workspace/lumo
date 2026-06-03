/** @jest-environment jsdom */

const en: Record<string, string> = {
  'sprint.burndown.title': 'Burndown',
  'sprint.burndown.empty': 'No burndown data yet',
  'sprint.burndown.remaining': 'Remaining',
  'sprint.burndown.ideal': 'Ideal',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

const mockUseSprintBurndown = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSprints', () => ({
  useSprintBurndown: (...a: unknown[]) => mockUseSprintBurndown(...a),
}))

import { render, screen } from '@testing-library/react'
import { SprintBurndownChart } from '@/app/workspace/[workspaceUrl]/sprints/components/SprintBurndownChart'

beforeEach(() => mockUseSprintBurndown.mockReset())

test('renders chart with legend and a polyline when data present', () => {
  mockUseSprintBurndown.mockReturnValue({
    burndown: {
      sprintId: 's1',
      start: '2026-06-01',
      end: '2026-06-03',
      unit: 'tasks',
      total: 3,
      series: [
        { date: '2026-06-01', remaining: 3, ideal: 3 },
        { date: '2026-06-02', remaining: 2, ideal: 1.5 },
        { date: '2026-06-03', remaining: 1, ideal: 0 },
      ],
    },
    isLoading: false,
    error: undefined,
  })
  const { container } = render(<SprintBurndownChart sprintId='s1' />)
  expect(screen.getByRole('heading', { name: 'Burndown' })).toBeInTheDocument()
  expect(screen.getByText('Remaining')).toBeInTheDocument()
  expect(screen.getByText('Ideal')).toBeInTheDocument()
  expect(container.querySelectorAll('polyline').length).toBeGreaterThanOrEqual(
    2
  )
})

test('renders empty state when total is 0', () => {
  mockUseSprintBurndown.mockReturnValue({
    burndown: {
      sprintId: 's1',
      start: '2026-06-01',
      end: '2026-06-01',
      unit: 'tasks',
      total: 0,
      series: [{ date: '2026-06-01', remaining: 0, ideal: 0 }],
    },
    isLoading: false,
    error: undefined,
  })
  render(<SprintBurndownChart sprintId='s1' />)
  expect(screen.getByText('No burndown data yet')).toBeInTheDocument()
})

test('actual polyline skips future days with null remaining', () => {
  mockUseSprintBurndown.mockReturnValue({
    burndown: {
      sprintId: 's1',
      start: '2026-06-01',
      end: '2026-06-03',
      unit: 'tasks',
      total: 2,
      series: [
        { date: '2026-06-01', remaining: 2, ideal: 2 },
        { date: '2026-06-02', remaining: 1, ideal: 1 },
        { date: '2026-06-03', remaining: null, ideal: 0 },
      ],
    },
    isLoading: false,
    error: undefined,
  })
  const { container } = render(<SprintBurndownChart sprintId='s1' />)
  const ideal = container.querySelector('polyline[stroke-dasharray]')
  const actual = Array.from(container.querySelectorAll('polyline')).find(
    p => !p.hasAttribute('stroke-dasharray')
  )
  const countPoints = (el: Element | null | undefined) =>
    (el?.getAttribute('points') ?? '').trim().split(/\s+/).filter(Boolean)
      .length
  expect(countPoints(ideal)).toBe(3) // ideal fills all 3 days
  expect(countPoints(actual)).toBe(2) // future null day is skipped
})
