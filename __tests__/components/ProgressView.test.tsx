/** @jest-environment jsdom */

const en: Record<string, string> = {
  'progress.title': 'Delivery in progress',
  'progress.agentRunning': 'Agent running',
  'progress.tokenUsage': 'Token usage · live',
  'progress.predictedMedian': 'Forecast median {value}',
  'progress.usedLabel': 'used',
  'progress.over': 'over budget',
  'progress.onTrackNote': 'within range · still accumulating',
  'progress.sectionLabel': 'Progress',
  'progress.iterations': 'Runs',
  'progress.clarifyRounds': 'Clarification rounds',
  'progress.predictedRange': 'Forecast {value}',
  'progress.soFar': 'so far {value}',
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
import { ProgressView } from '@/app/workspace/[workspaceUrl]/components/ProgressView'
import type { TaskProgress } from '@/lib/forecast/progress-types'

const iv = (p25: number, median: number, p75: number) => ({ p25, median, p75 })

const onTrack: TaskProgress = {
  sessionCount: 2,
  forecast: {} as TaskProgress['forecast'],
  tokenCost: {
    forecast: iv(12e6, 22e6, 35e6),
    actual: 18e6,
    deltaPct: null,
    band: 'on-track',
  },
  iterations: { forecast: iv(1, 2, 3), actual: 2, deltaPct: null, band: 'on-track' },
  clarifyRounds: { forecast: iv(0, 1, 1), actual: 0, deltaPct: null, band: 'on-track' },
}

const over: TaskProgress = {
  ...onTrack,
  tokenCost: {
    forecast: iv(12e6, 22e6, 35e6),
    actual: 52e6,
    deltaPct: 136,
    band: 'over',
  },
}

it('shows the on-track note and NO variance pill when within range', () => {
  render(<ProgressView progress={onTrack} agentStatus='WORKING' />)
  expect(screen.getByText(en['progress.onTrackNote']!)).toBeInTheDocument()
  expect(screen.queryByText(/over budget/)).not.toBeInTheDocument()
})

it('shows the over pill with deltaPct when token actual exceeds p75', () => {
  render(<ProgressView progress={over} agentStatus='WORKING' />)
  expect(screen.getByText(/over budget/)).toBeInTheDocument()
  expect(screen.getByText(/\+136%/)).toBeInTheDocument()
})

it('shows the running pulse only when agentStatus is WORKING', () => {
  const { rerender } = render(
    <ProgressView progress={onTrack} agentStatus='WORKING' />
  )
  expect(screen.getByText(en['progress.agentRunning']!)).toBeInTheDocument()
  rerender(<ProgressView progress={onTrack} agentStatus={null} />)
  expect(screen.queryByText(en['progress.agentRunning']!)).not.toBeInTheDocument()
})
