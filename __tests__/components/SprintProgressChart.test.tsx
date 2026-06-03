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

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { SprintProgressChart } from '@/app/workspace/[workspaceUrl]/sprints/components/SprintProgressChart'

/** Count space-separated coordinate pairs in a points attribute. */
function countPoints(el: Element): number {
  const pts = el.getAttribute('points') ?? ''
  return pts.trim().split(/\s+/).filter(Boolean).length
}

beforeEach(() => jest.clearAllMocks())

describe('SprintProgressChart', () => {
  it('renders chart with heading, legend, and polylines when data is present', () => {
    mockUseSprintBurnup.mockReturnValue({
      burnup: {
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
      },
      isLoading: false,
      error: undefined,
    })

    const { container } = render(<SprintProgressChart sprintId='s1' />)

    // heading
    expect(screen.getByRole('heading', { name: /Progress/i })).toBeInTheDocument()

    // legend labels
    expect(screen.getByText('Scope')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('Projected')).toBeInTheDocument()

    // all three polylines rendered (scope, projected, completed)
    const polylines = container.querySelectorAll('polyline')
    expect(polylines.length).toBe(3)
  })

  it('renders empty state when scopeTotal is 0', () => {
    mockUseSprintBurnup.mockReturnValue({
      burnup: {
        sprintId: 's1',
        start: '2026-06-01',
        end: '2026-06-01',
        unit: 'tasks',
        scopeTotal: 0,
        series: [{ date: '2026-06-01', scope: 0, completed: 0, projected: null }],
      },
      isLoading: false,
      error: undefined,
    })

    render(<SprintProgressChart sprintId='s1' />)

    expect(screen.getByText('No progress data yet')).toBeInTheDocument()
  })

  it('completed polyline skips future null days; projected polyline only spans its segment', () => {
    // ACTIVE-style: 06-01 has scope+completed but no projection,
    // 06-02 is the anchor (has both completed and projected),
    // 06-03 is future (completed=null, only projected).
    mockUseSprintBurnup.mockReturnValue({
      burnup: {
        sprintId: 's1',
        start: '2026-06-01',
        end: '2026-06-03',
        unit: 'tasks',
        scopeTotal: 2,
        series: [
          { date: '2026-06-01', scope: 2, completed: 1, projected: null },
          { date: '2026-06-02', scope: 2, completed: 1, projected: 1 },
          { date: '2026-06-03', scope: 2, completed: null, projected: 2 },
        ],
      },
      isLoading: false,
      error: undefined,
    })

    const { container } = render(<SprintProgressChart sprintId='s1' />)

    const polylines = container.querySelectorAll('polyline')
    expect(polylines.length).toBe(3)

    // Component renders polylines in this order: scope [0], projected [1], completed [2]
    // scope: className='text-muted-foreground', strokeWidth=1.5, no dasharray
    // projected: className='text-primary', strokeWidth=1.5, strokeDasharray='4 3'
    // completed: className='text-primary', strokeWidth=2, no dasharray

    // Find the projected polyline (dashed)
    const projectedPolyline = Array.from(polylines).find(
      pl => pl.getAttribute('stroke-dasharray') !== null
    )
    expect(projectedPolyline).toBeTruthy()

    // Find the completed polyline: text-primary, strokeWidth=2, no dasharray
    const completedPolyline = Array.from(polylines).find(
      pl =>
        pl.getAttribute('stroke-dasharray') === null &&
        pl.getAttribute('stroke-width') === '2'
    )
    expect(completedPolyline).toBeTruthy()

    // completed: days 06-01 (1) and 06-02 (1) are non-null; 06-03 is null → 2 points
    expect(countPoints(completedPolyline!)).toBe(2)

    // projected: day 06-01 is null; 06-02 (1) and 06-03 (2) are non-null → 2 points
    expect(countPoints(projectedPolyline!)).toBe(2)
  })
})
