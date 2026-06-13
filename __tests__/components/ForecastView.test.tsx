/** @jest-environment jsdom */

const en: Record<string, string> = {
  'forecast.title': 'Delivery forecast',
  'forecast.basis': 'Based on {count} similar tasks',
  'forecast.metricIterations': 'Iterations',
  'forecast.metricTokens': 'Token cost',
  'forecast.tokenBasis': 'Based on {count} tasks with cost data',
  'forecast.range': '{median} ({low}–{high})',
  'forecast.cycleDays': '{median}d ({low}–{high}d)',
  'forecast.cycleHours': '{median}h ({low}–{high}h)',
  'forecast.insufficient': 'Not enough history for a reliable forecast',
  'forecast.confidence': 'Confidence',
  'forecast.confidenceMedium': 'Medium',
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
    formatNumber: (n: number, opts?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en', opts).format(n),
  }),
}))

import { render, screen } from '@testing-library/react'
import { ForecastView } from '@/app/workspace/[workspaceUrl]/components/ForecastView'
import type { TaskForecast } from '@/lib/forecast/types'

const iv = (p25: number, median: number, p75: number) => ({ p25, median, p75 })

const base: TaskForecast = {
  insufficientData: false,
  cohortSize: 5,
  iterations: iv(1, 2, 3),
  mergedPrs: null,
  cycleHours: null,
  tokenCost: iv(12e6, 22e6, 35e6),
  tokenCostBasis: 8,
  clarifyRounds: iv(0, 1, 1),
  confidence: 'medium',
  sources: [],
}

it('renders the insufficient message when insufficientData', () => {
  render(<ForecastView forecast={{ ...base, insufficientData: true }} />)
  expect(screen.getByText(en['forecast.insufficient']!)).toBeInTheDocument()
})

it('renders iterations + token rows from the forecast prop', () => {
  render(<ForecastView forecast={base} />)
  expect(screen.getByText(en['forecast.title']!)).toBeInTheDocument()
  expect(screen.getByText('Iterations')).toBeInTheDocument()
  expect(screen.getByText('Token cost')).toBeInTheDocument()
})

it('renders a footer slot under a divider when provided', () => {
  render(<ForecastView forecast={base} footer={<div data-testid='slot' />} />)
  expect(screen.getByTestId('slot')).toBeInTheDocument()
})
