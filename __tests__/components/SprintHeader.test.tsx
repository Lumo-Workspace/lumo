/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import type { SprintBurnupResponse } from '@/lib/api-client/sprints'
import {
  CHART_VB_W,
  PLOT,
} from '@/app/workspace/[workspaceUrl]/sprints/components/burnup-chart'

// LUM-717 folded the three sprint stat cards (progress ring / time left /
// burnup sparkline) into one burnup card whose single readout line carries the
// progress and the end date, and reads out the hovered day.

function interpolate(msg: string, values?: Record<string, unknown>): string {
  if (!values) return msg
  return msg.replace(/\{(\w+)\}/g, (m, k) =>
    k in values ? String(values[k]) : m
  )
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en-US',
    formatMessage: (
      d: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => interpolate(d.defaultMessage ?? d.id, values),
  }),
}))

const mockUseBurnup = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSprints', () => ({
  useSprintBurnup: (...a: unknown[]) => mockUseBurnup(...a),
}))
// The date range owns its own api-client + toast chain; the header only has to
// place it.
jest.mock(
  '@/app/workspace/[workspaceUrl]/sprints/components/SprintDateRange',
  () => ({
    SprintDateRange: () => <div data-testid='date-range' />,
  })
)

import { SprintHeader } from '@/app/workspace/[workspaceUrl]/sprints/components/SprintHeader'

const sprint = {
  id: 'sprint_1',
  name: 'Sprint 8',
  startDate: new Date('2026-07-27T00:00:00.000Z'),
  endDate: new Date('2026-08-09T00:00:00.000Z'),
} as never

// 14 days, scope 12, measured on the first three.
const burnup: SprintBurnupResponse = {
  sprintId: 'sprint_1',
  start: '2026-07-27',
  end: '2026-08-09',
  unit: 'tasks',
  scopeTotal: 12,
  series: Array.from({ length: 14 }, (_, i) => ({
    date: `2026-0${i < 5 ? '7' : '8'}-${String(i < 5 ? 27 + i : i - 4).padStart(2, '0')}`,
    scope: 12,
    completed: i === 0 ? 2 : i === 1 ? 8 : i === 2 ? 12 : null,
    projected: null,
  })),
}

const renderHeader = () =>
  render(
    <SprintHeader
      sprint={sprint}
      progress={{ done: 12, total: 12 }}
      onRefresh={() => {}}
    />
  )

/**
 * jsdom gives every element a zero-size rect; the chart needs a real one. Laid
 * out at exactly the viewBox width so a clientX below maps 1:1 onto plot
 * coordinates whatever scale the viewBox is drawn at.
 */
function stubChartRect(svg: SVGSVGElement) {
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: CHART_VB_W, height: 170 }) as DOMRect
}

/** Plot x of day `i` across a 14-day sprint. */
const dayX = (i: number) => PLOT.left + (i / 13) * (PLOT.right - PLOT.left)

beforeEach(() => {
  jest.clearAllMocks()
  mockUseBurnup.mockReturnValue({ burnup, isLoading: false })
})

describe('SprintHeader', () => {
  it('collapses progress and time-left into one burnup card readout', () => {
    const { container } = renderHeader()

    // The name + state pill stay; the two extra stat cards are gone.
    expect(screen.getByText('Sprint 8')).toBeInTheDocument()
    expect(screen.queryByText('Progress')).not.toBeInTheDocument()
    expect(screen.queryByText('Time left')).not.toBeInTheDocument()
    expect(screen.queryByText(/tasks done/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Ends /)).not.toBeInTheDocument()

    // One card frame under the title row, and it is the burnup one.
    expect(container.querySelectorAll('.rounded-lg.border')).toHaveLength(1)
    expect(screen.getByText('Burnup')).toBeInTheDocument()

    // Progress and end date now read out on the card's single line.
    expect(screen.getByTestId('burnup-readout')).toHaveTextContent(
      '12 / 12 done · ends Aug 9'
    )
  })

  it('swaps the readout to the hovered day and restores it on leave', () => {
    const { container } = renderHeader()
    const svg = container.querySelector('svg')!
    stubChartRect(svg as SVGSVGElement)
    const readout = screen.getByTestId('burnup-readout')

    // The second day is measured: 8 of 12 completed.
    fireEvent.mouseMove(svg, { clientX: dayX(1) })
    expect(readout).toHaveTextContent('Jul 28 · 8 / 12 done')

    // Past the measured days the line reads the plan instead — the mid-point
    // of a straight 0 → 12 ramp.
    fireEvent.mouseMove(svg, { clientX: dayX(6) })
    expect(readout.textContent).toMatch(/planned$/)

    fireEvent.mouseLeave(svg)
    expect(readout).toHaveTextContent('12 / 12 done · ends Aug 9')
  })

  it('keeps the card and its readout when the burnup has too little data', () => {
    mockUseBurnup.mockReturnValue({
      burnup: { ...burnup, series: burnup.series.slice(0, 1) },
      isLoading: false,
    })
    renderHeader()
    expect(screen.getByText('Not enough data yet')).toBeInTheDocument()
    expect(screen.getByTestId('burnup-readout')).toHaveTextContent(
      '12 / 12 done · ends Aug 9'
    )
  })
})
