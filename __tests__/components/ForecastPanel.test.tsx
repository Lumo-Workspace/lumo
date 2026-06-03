/** @jest-environment jsdom */
const en: Record<string, string> = {
  'forecast.title': 'Delivery forecast',
  'forecast.insufficient': 'Not enough history yet',
  'forecast.basis': 'Based on {count} tasks',
  'forecast.range': '{median} ({low}–{high})',
  'forecast.metricIterations': 'Iterations',
  'forecast.viewSources': 'View sources',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => {
      const tpl = en[id] ?? id
      if (!values) return tpl
      return tpl.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ''))
    },
  }),
}))

import type { TaskForecast } from '@/lib/forecast/types'

let mockForecast: TaskForecast | undefined
const useTaskForecastMock = jest.fn((_taskId: string | null) => ({
  forecast: mockForecast,
  isLoading: false,
  error: undefined,
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTaskForecast', () => ({
  useTaskForecast: (taskId: string | null) => useTaskForecastMock(taskId),
}))

import { render, screen } from '@testing-library/react'
import { ForecastPanel } from '@/app/workspace/[workspaceUrl]/components/ForecastPanel'

const INSUFFICIENT: TaskForecast = {
  insufficientData: true,
  cohortSize: 0,
  iterations: null,
  mergedPrs: null,
  cycleHours: null,
  sources: [],
}

describe('ForecastPanel', () => {
  beforeEach(() => {
    useTaskForecastMock.mockClear()
    mockForecast = INSUFFICIENT
  })

  it('renders the insufficient-data message for a non-terminal task', () => {
    render(<ForecastPanel taskId='task_1' status='IN_PROGRESS' />)
    expect(screen.getByText('Not enough history yet')).toBeInTheDocument()
    expect(useTaskForecastMock).toHaveBeenCalledWith('task_1')
  })

  it('renders nothing for a DONE task — a delivered task has no forecast', () => {
    const { container } = render(
      <ForecastPanel taskId='task_1' status='DONE' />
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('Delivery forecast')).not.toBeInTheDocument()
    expect(screen.queryByText('Not enough history yet')).not.toBeInTheDocument()
  })

  it('does not fetch the forecast for a DONE task', () => {
    render(<ForecastPanel taskId='task_1' status='DONE' />)
    // taskId passed as null disables the underlying query (enabled: false).
    expect(useTaskForecastMock).toHaveBeenCalledWith(null)
  })
})
