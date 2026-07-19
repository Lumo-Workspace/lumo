/**
 * @jest-environment jsdom
 *
 * LUM-688 (the two HUMAN criteria, machine-backed): on a gate-B cluster card a
 * reviewer can uncheck and re-check individual ideas, the card reports how many
 * of the cluster's ideas are still kept, and only the kept ids ride along on the
 * confirm. Starring a cluster whose ideas were all unchecked is prevented, so
 * Stage 3 never receives a "plan this now" cluster with nothing in it.
 *
 * The idea list lives behind LUM-685's disclosure, so these tests expand it
 * first — that toggle is also where the kept/total count is shown.
 */

// jsdom lacks ResizeObserver, which the card's rationale auto-fit observes.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// react-intl ships ESM jest can't load from node_modules; the repo convention
// is an id-as-message passthrough so copy stays assertable (cf.
// IdeaEvidenceTab.test.tsx).
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      const base = defaultMessage ?? id
      return values ? `${base} ${Object.values(values).join(' ')}` : base
    },
  }),
  IntlProvider: ({ children }: { children: React.ReactNode }) => children,
}))

const mockGetAlignGate = jest.fn()
const mockConfirmAlignGate = jest.fn()

jest.mock('@/lib/api-client/plan-runs', () => ({
  planRunsClient: {
    getAlignGate: (...a: unknown[]) => mockGetAlignGate(...a),
    confirmAlignGate: (...a: unknown[]) => mockConfirmAlignGate(...a),
  },
}))

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GateBBoard } from '@/app/workspace/[workspaceUrl]/components/plan-run/GateBBoard'

const BUDGET = 'Agent run budget'
const HALF_BAKED = 'Deploy a Hermes-style agent (details TBD)'

const VIEW = {
  planRunId: 'run-1',
  stage: 'ALIGNMENT_READY',
  clusters: [
    {
      clusterId: 'cluster-0',
      name: 'Agents',
      thrust: 'automate the busywork',
      verdict: 'ALIGNED' as const,
      rationale: 'serves priority',
      customizationTrap: false,
      ideas: [
        { id: 'i1', statement: BUDGET },
        { id: 'i2', statement: HALF_BAKED },
      ],
    },
  ],
}

function renderBoard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <GateBBoard runId='run-1' />
    </QueryClientProvider>
  )
}

const keptToggle = () => screen.getByRole('button', { name: /ideasKept/ })
const star = () => screen.getByRole('button', { name: /planGate\.star/ })

/** Expand the disclosure so the per-idea checkboxes render. */
async function openIdeas() {
  const toggle = await screen.findByRole('button', { name: /ideasKept/ })
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle)
}

/** The checkbox whose label carries `statement`. */
function ideaCheckbox(statement: string): HTMLElement {
  const label = screen.getByText(statement).closest('label')
  const box = label?.querySelector('[role="checkbox"]')
  if (!box) throw new Error(`no checkbox for idea "${statement}"`)
  return box as HTMLElement
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAlignGate.mockResolvedValue(VIEW)
  mockConfirmAlignGate.mockResolvedValue({
    run: { id: 'run-1', stage: 'GENERATING' },
    selectedClusterIds: ['cluster-0'],
  })
})

it('starts with every idea kept and reports the kept count', async () => {
  renderBoard()

  expect(await screen.findByText('Agents')).toBeInTheDocument()
  // "{kept} of {total} ideas kept" — the intl mock appends the values.
  expect(keptToggle()).toHaveTextContent(/ideasKept 2 2/)

  await openIdeas()
  expect(ideaCheckbox(BUDGET)).toBeChecked()
  expect(ideaCheckbox(HALF_BAKED)).toBeChecked()
})

it('unchecking an idea drops it from the confirm; re-checking restores it', async () => {
  renderBoard()
  await openIdeas()

  fireEvent.click(ideaCheckbox(HALF_BAKED))
  expect(ideaCheckbox(HALF_BAKED)).not.toBeChecked()
  expect(keptToggle()).toHaveTextContent(/ideasKept 1 2/)

  fireEvent.click(star())
  fireEvent.click(screen.getByRole('button', { name: /planGate\.confirm/ }))

  await waitFor(() => expect(mockConfirmAlignGate).toHaveBeenCalledTimes(1))
  const payload = mockConfirmAlignGate.mock.calls[0]?.[1] as {
    clusters: { clusterId: string; ideaIds: string[] }[]
  }
  // The unchecked idea is absent — it stays in the pool for a later run.
  expect(payload.clusters[0]?.ideaIds).toEqual(['i1'])

  // Re-checking puts it back, in gate-A order.
  fireEvent.click(ideaCheckbox(HALF_BAKED))
  expect(keptToggle()).toHaveTextContent(/ideasKept 2 2/)
})

it('prevents starring a cluster whose ideas are all unchecked', async () => {
  renderBoard()
  await openIdeas()

  expect(star()).toBeEnabled()

  fireEvent.click(ideaCheckbox(BUDGET))
  fireEvent.click(ideaCheckbox(HALF_BAKED))

  expect(keptToggle()).toHaveTextContent(/ideasKept 0 2/)
  expect(star()).toBeDisabled()
})

it('un-stars a cluster when its last kept idea is unchecked', async () => {
  renderBoard()
  await openIdeas()

  fireEvent.click(star())
  expect(star()).toHaveAttribute('aria-pressed', 'true')

  fireEvent.click(ideaCheckbox(BUDGET))
  fireEvent.click(ideaCheckbox(HALF_BAKED))

  // The star cannot survive an emptied cluster — nothing left to plan.
  expect(star()).toHaveAttribute('aria-pressed', 'false')
  // …and with no selection there is nothing to hand Stage 3.
  expect(
    screen.getByRole('button', { name: /planGate\.confirm/ })
  ).toBeDisabled()
})
