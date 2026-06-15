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
  'retrospective.interactionRounds': 'Interaction rounds',
  'retrospective.totalDuration': 'Run time',
  'retrospective.bandWithin': 'within the usual range',
  'retrospective.bandAbove': 'above the usual range',
  'retrospective.bandBelow': 'below the usual range',
  'retrospective.flywheel':
    'Based on {count} similar tasks in the reference library · this run included',
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
import type { TaskRetrospective } from '@/lib/forecast/retrospective-types'

const fetchRetro = tasksClient.retrospective as jest.Mock

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const iv = (p25: number, median: number, p75: number) => ({ p25, median, p75 })

function full(overrides?: Partial<TaskRetrospective>): TaskRetrospective {
  return {
    tokenCost: {
      forecast: iv(2.4e7, 2.9e7, 3e7),
      actual: 1.6e8,
      deltaPct: 13,
      band: 'within',
    },
    iterations: {
      forecast: iv(1, 1, 1),
      actual: 1,
      deltaPct: 0,
      band: 'within',
    },
    interactionRounds: {
      forecast: null,
      actual: 0,
      deltaPct: null,
      band: null,
    },
    totalDuration: {
      forecast: null,
      actual: 217,
      deltaPct: null,
      band: null,
    },
    referenceLibrarySize: 27,
    capturedAt: new Date('2026-06-01'),
    ...overrides,
  }
}

beforeEach(() => fetchRetro.mockReset())

it('renders nothing for a non-DONE task (no fetch)', () => {
  const { container } = render(
    <Wrapper>
      <RetrospectivePanel taskId='t1' status='IN_PROGRESS' />
    </Wrapper>
  )
  expect(container).toBeEmptyDOMElement()
  expect(fetchRetro).not.toHaveBeenCalled()
})

it('renders nothing when retrospective is null', async () => {
  fetchRetro.mockResolvedValue({ retrospective: null })
  const { container } = render(
    <Wrapper>
      <RetrospectivePanel taskId='t1' status='DONE' />
    </Wrapper>
  )
  await waitFor(() => expect(fetchRetro).toHaveBeenCalled())
  expect(container).toBeEmptyDOMElement()
})

it('renders token compare + flywheel count', async () => {
  fetchRetro.mockResolvedValue({ retrospective: full() })
  render(
    <Wrapper>
      <RetrospectivePanel taskId='t1' status='DONE' />
    </Wrapper>
  )
  await screen.findByText(en['retrospective.title']!)
  expect(screen.getByText('+13%', { exact: false })).toBeInTheDocument()
  expect(screen.getByText(/27/, { exact: false })).toBeInTheDocument()
})

it('renders a footer slot when provided', async () => {
  fetchRetro.mockResolvedValue({ retrospective: full() })
  render(
    <Wrapper>
      <RetrospectivePanel
        taskId='t1'
        status='DONE'
        footer={<div data-testid='slot' />}
      />
    </Wrapper>
  )
  await screen.findByText(en['retrospective.title']!)
  expect(screen.getByTestId('slot')).toBeInTheDocument()
})

it('orders the Token section (forecast + footer) above the Delivery section', async () => {
  fetchRetro.mockResolvedValue({ retrospective: full() })
  const { container } = render(
    <Wrapper>
      <RetrospectivePanel
        taskId='t1'
        status='DONE'
        footer={<div data-testid='slot'>FOOTERMARK</div>}
      />
    </Wrapper>
  )
  await screen.findByTestId('slot')
  const html = container.innerHTML
  // ">Delivery<" isolates the delivery-section heading from "Delivery retrospective" in the title
  expect(html.indexOf('Token usage')).toBeLessThan(html.indexOf('FOOTERMARK'))
  expect(html.indexOf('FOOTERMARK')).toBeLessThan(html.indexOf('>Delivery<'))
})

it('renders the flywheel note inline with the interpolated count', async () => {
  fetchRetro.mockResolvedValue({
    retrospective: full({ referenceLibrarySize: 368 }),
  })
  render(
    <Wrapper>
      <RetrospectivePanel taskId='t1' status='DONE' />
    </Wrapper>
  )
  expect(await screen.findByText(/368/)).toBeInTheDocument()
})

it('renders the three delivery metrics (labels present, run-time duration-formatted)', async () => {
  fetchRetro.mockResolvedValue({ retrospective: full() })
  render(
    <Wrapper>
      <RetrospectivePanel taskId='t1' status='DONE' />
    </Wrapper>
  )
  expect(await screen.findByText('Runs')).toBeInTheDocument()
  expect(screen.getByText('Interaction rounds')).toBeInTheDocument()
  expect(screen.getByText('Run time')).toBeInTheDocument()
})

it('RetrospectivePanel renders the KPI block without the forecast hint', async () => {
  // full() has iterations.forecast = (1,1,1); the old design showed a "(1–1)" hint
  fetchRetro.mockResolvedValue({ retrospective: full() })
  render(
    <Wrapper>
      <RetrospectivePanel taskId='t1' status='DONE' />
    </Wrapper>
  )
  await screen.findByText('Runs')
  // the labeled block + value are present
  expect(screen.getByText('Delivery')).toBeInTheDocument()
  // but no forecast range hint on 运行次数
  expect(screen.queryByText(/1–1/)).not.toBeInTheDocument()
  expect(screen.queryByText(/\(1/)).not.toBeInTheDocument()
})

it('duration-formats totalDuration in the delivery section', async () => {
  fetchRetro.mockResolvedValue({
    retrospective: full({
      totalDuration: {
        forecast: null,
        actual: 17692,
        deltaPct: null,
        band: null,
      },
    }),
  })
  render(
    <Wrapper>
      <RetrospectivePanel taskId='t1' status='DONE' />
    </Wrapper>
  )
  expect(await screen.findByText('Run time')).toBeInTheDocument()
  expect(screen.getByText(/294m 52s/)).toBeInTheDocument()
})
