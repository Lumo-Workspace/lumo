/** @jest-environment jsdom */

// react-intl ships pure ESM and can't be transformed by jest without special
// config. Mock it the same way all other component tests in this project do.
const en: Record<string, string> = {
  'retrospective.title': 'Delivery retrospective',
  'retrospective.done': 'Done',
  'retrospective.tokenUsage': 'Token usage',
  'retrospective.predicted': 'Forecast {value}',
  'retrospective.actual': 'actual {value}',
  'retrospective.actualLabel': 'actual',
  'retrospective.delivery': 'Delivery',
  'retrospective.iterations': 'Runs',
  'retrospective.clarifyRounds': 'Clarification rounds',
  'retrospective.noForecast': 'no forecast history yet',
  'retrospective.bandWithin': 'within the usual range',
  'retrospective.bandAbove': 'above the usual range',
  'retrospective.bandBelow': 'below the usual range',
  'retrospective.flywheel':
    'Added to the reference library for forecasting future similar tasks ({count} now)',
  'forecast.range': '{median} ({low}–{high})',
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

jest.mock('@/lib/api-client', () => ({
  tasksClient: { retrospective: jest.fn() },
}))

import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RetrospectivePanel } from '@/app/workspace/[workspaceUrl]/components/RetrospectivePanel'
import { tasksClient } from '@/lib/api-client'

const fetchRetro = tasksClient.retrospective as jest.Mock

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const iv = (p25: number, median: number, p75: number) => ({ p25, median, p75 })

beforeEach(() => fetchRetro.mockReset())

it('renders nothing for a non-DONE task (no fetch)', () => {
  const { container } = wrap(
    <RetrospectivePanel taskId='t1' status='IN_PROGRESS' />
  )
  expect(container).toBeEmptyDOMElement()
  expect(fetchRetro).not.toHaveBeenCalled()
})

it('renders nothing when retrospective is null', async () => {
  fetchRetro.mockResolvedValue({ retrospective: null })
  const { container } = wrap(<RetrospectivePanel taskId='t1' status='DONE' />)
  await waitFor(() => expect(fetchRetro).toHaveBeenCalled())
  expect(container).toBeEmptyDOMElement()
})

it('renders token compare + delivery rows + flywheel count', async () => {
  fetchRetro.mockResolvedValue({
    retrospective: {
      tokenCost: {
        forecast: iv(2.4e7, 2.6e7, 3e7),
        actual: 2.95e7,
        deltaPct: 13,
        band: 'within',
      },
      iterations: {
        forecast: iv(2, 3, 3),
        actual: 3,
        deltaPct: 0,
        band: 'within',
      },
      clarifyRounds: {
        forecast: iv(1, 1, 2),
        actual: 2,
        deltaPct: 100,
        band: 'within',
      },
      referenceLibrarySize: 27,
      capturedAt: '2026-06-01',
    },
  })
  wrap(<RetrospectivePanel taskId='t1' status='DONE' />)
  await screen.findByText(en['retrospective.title']!)
  expect(screen.getByText('+13%', { exact: false })).toBeInTheDocument()
  expect(screen.getByText('27', { exact: false })).toBeInTheDocument()
})

it('degrades a row to actual-only when its forecast is null', async () => {
  fetchRetro.mockResolvedValue({
    retrospective: {
      tokenCost: { forecast: null, actual: null, deltaPct: null, band: null },
      iterations: {
        forecast: iv(1, 2, 2),
        actual: 4,
        deltaPct: 100,
        band: 'above',
      },
      clarifyRounds: { forecast: null, actual: 3, deltaPct: null, band: null },
      referenceLibrarySize: 10,
      capturedAt: '2026-06-01',
    },
  })
  wrap(<RetrospectivePanel taskId='t1' status='DONE' />)
  await screen.findByText(en['retrospective.title']!)
  // clarify row degrades — "no forecast history yet" text appears
  expect(
    screen.getByText(en['retrospective.noForecast']!, { exact: false })
  ).toBeInTheDocument()
})

it('renders a footer slot under a divider when provided', async () => {
  fetchRetro.mockResolvedValue({
    retrospective: {
      tokenCost: {
        forecast: iv(2.4e7, 2.6e7, 3e7),
        actual: 2.95e7,
        deltaPct: 13,
        band: 'within',
      },
      iterations: {
        forecast: iv(2, 3, 3),
        actual: 3,
        deltaPct: 0,
        band: 'within',
      },
      clarifyRounds: {
        forecast: iv(1, 1, 2),
        actual: 2,
        deltaPct: 100,
        band: 'within',
      },
      referenceLibrarySize: 27,
      capturedAt: '2026-06-01',
    },
  })
  wrap(
    <RetrospectivePanel
      taskId='t1'
      status='DONE'
      footer={<div data-testid='slot' />}
    />
  )
  await screen.findByText(en['retrospective.title']!)
  expect(screen.getByTestId('slot')).toBeInTheDocument()
})
