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
  'progress.summaryRuns': '{value} runs so far',
  'progress.summaryTokens': '{value} tokens used',
  'progress.summaryClarify': '{value} clarification rounds',
  'progress.totalDuration': 'Run time',
  'progress.summaryDuration': 'Ran {value}',
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
  iterations: {
    forecast: iv(1, 2, 3),
    actual: 2,
    deltaPct: null,
    band: 'on-track',
  },
  interactionRounds: {
    forecast: iv(0, 1, 1),
    actual: 0,
    deltaPct: null,
    band: 'on-track',
  },
  totalDuration: { forecast: null, actual: 0, deltaPct: null, band: null },
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
  expect(
    screen.queryByText(en['progress.agentRunning']!)
  ).not.toBeInTheDocument()
})

const noForecastWithToken: TaskProgress = {
  sessionCount: 1,
  forecast: {} as TaskProgress['forecast'],
  tokenCost: { forecast: null, actual: 12000, deltaPct: null, band: null },
  iterations: { forecast: null, actual: 1, deltaPct: null, band: null },
  interactionRounds: { forecast: null, actual: 0, deltaPct: null, band: null },
  totalDuration: { forecast: null, actual: 0, deltaPct: null, band: null },
}

const noForecastMinimal: TaskProgress = {
  ...noForecastWithToken,
  tokenCost: { forecast: null, actual: null, deltaPct: null, band: null },
}

const noForecastWithClarify: TaskProgress = {
  ...noForecastMinimal,
  interactionRounds: { forecast: null, actual: 2, deltaPct: null, band: null },
}

it('renders an in-progress summary (runs + token) when there is no forecast', () => {
  render(<ProgressView progress={noForecastWithToken} agentStatus={null} />)
  expect(screen.getByText('1 runs so far')).toBeInTheDocument()
  expect(screen.getByText('12K tokens used')).toBeInTheDocument()
  expect(screen.queryByText('Progress')).not.toBeInTheDocument()
  expect(screen.queryByText('so far 1')).not.toBeInTheDocument()
  expect(screen.queryByText(/Forecast/)).not.toBeInTheDocument()
})

it('hides zero/no-signal metrics in summary mode (LUM-324 case)', () => {
  render(<ProgressView progress={noForecastMinimal} agentStatus={null} />)
  expect(screen.getByText('1 runs so far')).toBeInTheDocument()
  expect(screen.queryByText(/tokens used/)).not.toBeInTheDocument()
  expect(screen.queryByText(/clarification rounds/)).not.toBeInTheDocument()
  expect(screen.queryByText('Progress')).not.toBeInTheDocument()
})

it('shows the clarify summary line only when actual > 0', () => {
  render(<ProgressView progress={noForecastWithClarify} agentStatus={null} />)
  expect(screen.getByText('2 clarification rounds')).toBeInTheDocument()
  expect(screen.getByText('1 runs so far')).toBeInTheDocument()
})

it('does NOT render summary lines when a forecast is present', () => {
  render(<ProgressView progress={onTrack} agentStatus='WORKING' />)
  expect(screen.queryByText(/runs so far/)).not.toBeInTheDocument()
  expect(screen.queryByText(/tokens used/)).not.toBeInTheDocument()
  expect(screen.getByText('Progress')).toBeInTheDocument()
})

const tokenBandNoCohort: TaskProgress = {
  sessionCount: 1,
  forecast: {} as TaskProgress['forecast'],
  tokenCost: {
    forecast: iv(12e6, 22e6, 35e6),
    actual: 18e6,
    deltaPct: null,
    band: 'on-track',
  },
  iterations: { forecast: null, actual: 1, deltaPct: null, band: null },
  interactionRounds: { forecast: null, actual: 0, deltaPct: null, band: null },
  totalDuration: { forecast: null, actual: 0, deltaPct: null, band: null },
}

it('renders the token band AND a runs-only summary when token forecast exists but cohort does not', () => {
  render(<ProgressView progress={tokenBandNoCohort} agentStatus={null} />)
  // band block present (on-track note)
  expect(
    screen.getByText('within range · still accumulating')
  ).toBeInTheDocument()
  // summary runs line present
  expect(screen.getByText('1 runs so far')).toBeInTheDocument()
  // NO duplicate token summary line (band already shows token; showTokenSummary is false)
  expect(screen.queryByText(/tokens used/)).not.toBeInTheDocument()
  // not the compare section
  expect(screen.queryByText('Progress')).not.toBeInTheDocument()
})

it('renders a footer slot under a divider when provided', () => {
  render(
    <ProgressView
      progress={onTrack}
      agentStatus={null}
      footer={<div data-testid='slot' />}
    />
  )
  expect(screen.getByTestId('slot')).toBeInTheDocument()
})

const withDuration: TaskProgress = {
  ...onTrack,
  totalDuration: { forecast: null, actual: 18760, deltaPct: null, band: null },
}

it('shows the run-time row in the cohort-forecast layout', () => {
  render(<ProgressView progress={withDuration} agentStatus={null} />)
  expect(screen.getByText('Run time')).toBeInTheDocument()
  expect(screen.getByText(/312m 40s/)).toBeInTheDocument()
})

const noForecastWithDuration: TaskProgress = {
  ...noForecastMinimal,
  totalDuration: { forecast: null, actual: 18760, deltaPct: null, band: null },
}

it('shows a run-time summary line in the no-forecast layout when > 0', () => {
  render(<ProgressView progress={noForecastWithDuration} agentStatus={null} />)
  expect(screen.getByText(/312m 40s/)).toBeInTheDocument()
})

it('omits the run-time summary line when duration is 0', () => {
  render(<ProgressView progress={noForecastMinimal} agentStatus={null} />)
  expect(screen.queryByText(/312m 40s/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Ran /)).not.toBeInTheDocument()
})
