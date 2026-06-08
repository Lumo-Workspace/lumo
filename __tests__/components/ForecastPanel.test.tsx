/** @jest-environment jsdom */
const en: Record<string, string> = {
  'forecast.title': 'Delivery forecast',
  'forecast.insufficient': 'Not enough history yet',
  'forecast.basis': 'Based on {count} tasks',
  'forecast.range': '{median} ({low}–{high})',
  'forecast.metricIterations': 'Iterations',
  'forecast.metricTokens': 'Token cost',
  'forecast.tokenBasis': 'Based on {count} tasks with cost data',
  'forecast.viewSources': 'View sources',
  'forecast.confidence': 'Confidence',
  'forecast.confidenceLow': 'Low',
  'forecast.confidenceMedium': 'Medium',
  'forecast.confidenceHigh': 'High',
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
    formatNumber: (n: number) => String(n),
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
  tokenCost: null,
  tokenCostBasis: 0,
  confidence: 'low',
  sources: [],
}

// Cohort track empty, but a project-wide token forecast is available.
const TOKEN_ONLY: TaskForecast = {
  insufficientData: false,
  cohortSize: 0,
  iterations: null,
  mergedPrs: null,
  cycleHours: null,
  tokenCost: { p25: 14_000_000, median: 30_000_000, p75: 41_000_000 },
  tokenCostBasis: 22,
  confidence: 'high',
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

  it('renders a token-cost forecast with its basis caveat when cohort is empty', () => {
    mockForecast = TOKEN_ONLY
    render(<ForecastPanel taskId='task_1' status='IN_PROGRESS' />)
    expect(screen.getByText('Token cost')).toBeInTheDocument()
    expect(
      screen.getByText('Based on 22 tasks with cost data')
    ).toBeInTheDocument()
    // No similarity-cohort basis line when there are no cohort metrics.
    expect(screen.queryByText('Based on 0 tasks')).not.toBeInTheDocument()
    expect(screen.queryByText('Not enough history yet')).not.toBeInTheDocument()
  })

  it('renders the confidence badge derived from sample size', () => {
    mockForecast = TOKEN_ONLY
    render(<ForecastPanel taskId='task_1' status='IN_PROGRESS' />)
    expect(screen.getByText(/Confidence · High/)).toBeInTheDocument()
  })

  it('shows no confidence badge for the insufficient-data state', () => {
    render(<ForecastPanel taskId='task_1' status='IN_PROGRESS' />)
    expect(screen.queryByText(/Confidence/)).not.toBeInTheDocument()
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
