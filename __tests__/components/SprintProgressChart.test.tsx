/** @jest-environment jsdom */

const messages: Record<string, string> = {
  'sprint.burnup.title': 'Progress',
  'sprint.burnup.empty': 'No progress data yet',
  'sprint.burnup.scope': 'Scope',
  'sprint.burnup.completed': 'Completed',
  'sprint.burnup.projected': 'Projected',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
  }),
}))

const mockUseSprintBurnup = jest.fn()

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSprints', () => ({
  useSprintBurnup: (...a: unknown[]) => mockUseSprintBurnup(...a),
}))

// Recharts' ResponsiveContainer measures its parent (0×0 in jsdom) and renders
// nothing. Replace it with a fixed-size passthrough so the AreaChart mounts and
// produces an <svg> we can assert on.
jest.mock('recharts', () => {
  const Original = jest.requireActual('recharts')
  const React = jest.requireActual('react')
  return {
    ...Original,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 500, height: 300 }),
  }
})

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import {
  SprintProgressChart,
  buildBurnupChartData,
} from '@/app/workspace/[workspaceUrl]/sprints/components/SprintProgressChart'
import type { SprintBurnupResponse } from '@/lib/api-client/sprints'

const burnup = (
  overrides: Partial<SprintBurnupResponse> = {}
): SprintBurnupResponse => ({
  sprintId: 's1',
  start: '2026-06-01',
  end: '2026-06-03',
  unit: 'tasks',
  scopeTotal: 3,
  series: [
    { date: '2026-06-01', scope: 1, completed: 0, projected: null },
    { date: '2026-06-02', scope: 2, completed: 1, projected: null },
    { date: '2026-06-03', scope: 3, completed: 3, projected: null },
  ],
  ...overrides,
})

beforeEach(() => jest.clearAllMocks())

describe('buildBurnupChartData', () => {
  it('returns one row per series point, preserving nulls', () => {
    const { rows } = buildBurnupChartData(
      burnup({
        scopeTotal: 2,
        series: [
          { date: '2026-06-01', scope: 2, completed: 1, projected: null },
          { date: '2026-06-02', scope: 2, completed: 1, projected: 1 },
          { date: '2026-06-03', scope: 2, completed: null, projected: 2 },
        ],
      })
    )

    expect(rows).toHaveLength(3)
    // future day keeps completed null; pre-anchor day keeps projected null
    expect(rows[2]!.completed).toBeNull()
    expect(rows[0]!.projected).toBeNull()
    expect(rows[1]!).toMatchObject({ completed: 1, projected: 1, scope: 2 })
  })

  it('maxY is the larger of scopeTotal and 1', () => {
    expect(buildBurnupChartData(burnup({ scopeTotal: 5 })).maxY).toBe(5)
    expect(buildBurnupChartData(burnup({ scopeTotal: 0 })).maxY).toBe(1)
  })
})

describe('SprintProgressChart', () => {
  it('renders heading, legend labels, and a chart svg when data is present', () => {
    mockUseSprintBurnup.mockReturnValue({
      burnup: burnup(),
      isLoading: false,
      error: undefined,
    })

    const { container } = render(<SprintProgressChart sprintId='s1' />)

    expect(
      screen.getByRole('heading', { name: /Progress/i })
    ).toBeInTheDocument()

    // custom HTML legend (rendered outside recharts → always in the DOM)
    expect(screen.getByText('Scope')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('Projected')).toBeInTheDocument()

    // the recharts area chart mounts
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('renders the loading skeleton while fetching', () => {
    mockUseSprintBurnup.mockReturnValue({
      burnup: undefined,
      isLoading: true,
      error: undefined,
    })

    const { container } = render(<SprintProgressChart sprintId='s1' />)

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
    expect(screen.queryByText('Completed')).not.toBeInTheDocument()
  })

  it('renders empty state when scopeTotal is 0', () => {
    mockUseSprintBurnup.mockReturnValue({
      burnup: burnup({
        scopeTotal: 0,
        series: [
          { date: '2026-06-01', scope: 0, completed: 0, projected: null },
        ],
      }),
      isLoading: false,
      error: undefined,
    })

    render(<SprintProgressChart sprintId='s1' />)

    expect(screen.getByText('No progress data yet')).toBeInTheDocument()
  })
})
