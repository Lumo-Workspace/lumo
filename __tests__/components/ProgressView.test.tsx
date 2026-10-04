/** @jest-environment jsdom */

const en: Record<string, string> = {
  'progress.title': 'Delivery in progress',
  'progress.agentRunning': 'Agent running',
  'progress.tokenUsage': 'Token usage · live',
  'progress.predictedMedian': 'Forecast median {value}',
  'progress.usedLabel': 'used',
  'progress.over': 'over budget',
  'usage.preDedupe.notice': 'PRE-DEDUPE NOTICE',
  'progress.onTrackNote': 'within range · still accumulating',
  // shared delivery-KPI labels (DeliveryKpis reuses the retrospective.* keys)
  'retrospective.delivery': 'Delivery',
  'retrospective.iterations': 'Runs',
  'retrospective.interactionRounds': 'Interaction rounds',
  'retrospective.totalDuration': 'Run time',
  'duration.hours': '{hours}h',
  'duration.minutes': '{minutes}m',
  'duration.seconds': '{seconds}s',
  'duration.milliseconds': '{ms}ms',
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
    actual: 4,
    deltaPct: null,
    band: 'on-track',
  },
  totalDuration: { forecast: null, actual: 766, deltaPct: null, band: null },
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

it('ProgressView renders the unified DeliveryKpis block without forecast compare rows', () => {
  render(<ProgressView progress={onTrack} agentStatus='WORKING' />)
  // shared labeled KPI block (same as the done card)
  expect(screen.getByText('Delivery')).toBeInTheDocument()
  expect(screen.getByText('Runs')).toBeInTheDocument()
  expect(screen.getByText('Interaction rounds')).toBeInTheDocument()
  expect(screen.getByText('Run time')).toBeInTheDocument()
  // values only — no forecast compare rows, no plain summary lines
  expect(screen.getByText('2')).toBeInTheDocument()
  expect(screen.getByText('4')).toBeInTheDocument()
  expect(screen.getByText('12m 46s')).toBeInTheDocument()
  expect(screen.queryByText('Progress')).not.toBeInTheDocument()
  expect(screen.queryByText(/so far/)).not.toBeInTheDocument()
  expect(screen.queryByText(/runs so far/)).not.toBeInTheDocument()
  // token zone keeps its own forecast; the KPI block carries none
  expect(screen.getByText(/Forecast median/)).toBeInTheDocument()
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

it('renders a token-used line in the token zone when there is no forecast band', () => {
  render(<ProgressView progress={noForecastWithToken} agentStatus={null} />)
  // token-used relocated into the token zone (label + compact value), not a KPI
  expect(screen.getByText('Token usage · live')).toBeInTheDocument()
  expect(screen.getByText('used')).toBeInTheDocument()
  expect(screen.getByText('12K')).toBeInTheDocument()
  // KPI block still present with all three metrics
  expect(screen.getByText('Delivery')).toBeInTheDocument()
  expect(screen.getByText('Runs')).toBeInTheDocument()
})

it('always renders all three KPI metrics even when zero/null (em-dash for null duration)', () => {
  render(<ProgressView progress={noForecastMinimal} agentStatus={null} />)
  expect(screen.getByText('Runs')).toBeInTheDocument()
  expect(screen.getByText('Interaction rounds')).toBeInTheDocument()
  expect(screen.getByText('Run time')).toBeInTheDocument()
  // no token-used line when there is no token actual
  expect(screen.queryByText('used')).not.toBeInTheDocument()
})

it('renders the footer slot above the Delivery KPI block (matches the done card order)', () => {
  const { container } = render(
    <ProgressView
      progress={onTrack}
      agentStatus={null}
      footer={<div data-testid='slot'>FOOTERMARK</div>}
    />
  )
  expect(screen.getByTestId('slot')).toBeInTheDocument()
  const html = container.innerHTML
  // per-model footer comes first; the 交付 KPI block ("Delivery") sits last
  expect(html.indexOf('FOOTERMARK')).toBeLessThan(html.indexOf('>Delivery<'))
})

const withDuration: TaskProgress = {
  ...onTrack,
  totalDuration: { forecast: null, actual: 18760, deltaPct: null, band: null },
}

it('duration-formats the run-time KPI', () => {
  render(<ProgressView progress={withDuration} agentStatus={null} />)
  expect(screen.getByText('Run time')).toBeInTheDocument()
  expect(screen.getByText(/312m 40s/)).toBeInTheDocument()
})

describe('ProgressView — pre-dedupe notice (LUM-932)', () => {
  it('shows the notice under the token usage figure when preDedupe is set', () => {
    render(<ProgressView progress={onTrack} preDedupe />)
    expect(screen.getByTestId('usage-pre-dedupe')).toHaveTextContent(
      'PRE-DEDUPE NOTICE'
    )
    expect(screen.getByTestId('usage-pre-dedupe')).toHaveClass(
      'text-warning-text'
    )
  })

  it('omits the notice by default', () => {
    render(<ProgressView progress={onTrack} />)
    expect(screen.queryByTestId('usage-pre-dedupe')).toBeNull()
  })

  it('shows the notice in the used-only branch (no forecast band)', () => {
    const usedOnly = {
      ...onTrack,
      tokenCost: { forecast: null, actual: 12000, deltaPct: null, band: null },
    } as TaskProgress
    const { rerender } = render(<ProgressView progress={usedOnly} preDedupe />)
    expect(screen.getByTestId('usage-pre-dedupe')).toHaveTextContent(
      'PRE-DEDUPE NOTICE'
    )
    rerender(<ProgressView progress={usedOnly} />)
    expect(screen.queryByTestId('usage-pre-dedupe')).toBeNull()
  })
})
