/** @jest-environment jsdom */
/**
 * LUM-496 Task 2: the boundary-crossings panel groups its rows by category into
 * collapsible group rows, and can render just the open subset (the NEEDS ACTION
 * zone) or just the dispositioned subset (the record below). The per-crossing
 * row itself is untouched — these tests only pin the wrapper.
 *
 * Mocking style mirrors __tests__/boundary-crossings-panel-advisory.test.tsx:
 * react-intl / sonner / api-client are stubbed so the client module loads under
 * jsdom without a provider.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      let msg = defaultMessage ?? id
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.split(`{${k}}`).join(String(v))
      }
      return msg
    },
  }),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings', () => ({
  useBoundaryCrossings: jest.fn(),
}))
jest.mock('@/lib/api-client', () => ({
  tasksClient: {
    dispositionBoundaryCrossing: jest.fn().mockResolvedValue({}),
    spawnBoundaryRemediation: jest.fn().mockResolvedValue({}),
    explainBoundaryCrossing: jest.fn().mockResolvedValue({}),
  },
}))

import '@testing-library/jest-dom'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { BoundaryCrossingsPanel } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BoundaryCrossingsPanel'
import { useBoundaryCrossings } from '@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings'

const mockCrossings = useBoundaryCrossings as jest.Mock

function makeCrossing(over: Record<string, unknown>) {
  return {
    id: 'bc-x',
    category: 'PROJECT_RULE_VIOLATION',
    detail: 'ran a forbidden command',
    detectedAt: '2026-09-01T00:00:00.000Z',
    reversible: true,
    occurrenceCount: 1,
    lastSeenAt: '2026-09-01T00:00:00.000Z',
    severity: 'MEDIUM',
    disposition: null,
    dispositionNote: null,
    dispositionedAt: null,
    dispositionedById: null,
    remediationTask: null,
    editChange: null,
    lastDispositionChange: null,
    attribution: null,
    explanations: [],
    advisory: false,
    policyRuleRef: null,
    policyRuleText: null,
    agentContext: null,
    systemExplanation: null,
    ...over,
  }
}

function setCrossings(crossings: unknown[], gateEnabled = true) {
  mockCrossings.mockReturnValue({
    crossings,
    gateEnabled,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
}

/** One open blocking DB crossing + two advisory project-rule ones. */
const mixed = [
  makeCrossing({ id: 'bc-db', category: 'DESTRUCTIVE_DB_COMMAND' }),
  makeCrossing({ id: 'bc-rule-1', advisory: true }),
  makeCrossing({ id: 'bc-rule-2', advisory: true }),
  makeCrossing({
    id: 'bc-done',
    category: 'SCOPE_EXPANSION',
    severity: 'LOW',
    disposition: 'CONFIRMED',
    dispositionedAt: '2026-09-02T00:00:00.000Z',
  }),
]

beforeEach(() => jest.clearAllMocks())
afterEach(cleanup)

it('renders one group row per category with severity, advisory and open/total', () => {
  setCrossings(mixed)
  render(<BoundaryCrossingsPanel taskIdentifier='LUM-496' enabled />)

  const db = screen.getByTestId('crossing-group-DESTRUCTIVE_DB_COMMAND')
  const rule = screen.getByTestId('crossing-group-PROJECT_RULE_VIOLATION')
  const scope = screen.getByTestId('crossing-group-SCOPE_EXPANSION')

  expect(db).toHaveTextContent('destructive database command')
  expect(db).toHaveTextContent('medium severity')
  expect(db).toHaveTextContent('1 open / 1')
  // Every project-rule crossing is advisory, so the group says so.
  expect(rule).toHaveTextContent('· advisory')
  expect(rule).toHaveTextContent('2 open / 2')
  // A fully dispositioned group is not advisory and reads 0 open.
  expect(scope).not.toHaveTextContent('advisory')
  expect(scope).toHaveTextContent('0 open / 1')

  // Blocking group sorts to the top of the list.
  expect(
    db.compareDocumentPosition(rule) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
})

it('expands only the first group holding an open blocking crossing', () => {
  setCrossings(mixed)
  render(<BoundaryCrossingsPanel taskIdentifier='LUM-496' enabled />)

  expect(
    screen.getByTestId('crossing-group-DESTRUCTIVE_DB_COMMAND')
  ).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByTestId('crossing-toggle-bc-db')).toBeInTheDocument()

  // The advisory group and the settled group stay folded — their rows are not
  // mounted until the reviewer asks for them.
  expect(
    screen.getByTestId('crossing-group-PROJECT_RULE_VIOLATION')
  ).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByTestId('crossing-toggle-bc-rule-1')).toBeNull()
  expect(screen.queryByTestId('crossing-toggle-bc-done')).toBeNull()
})

it('manual group toggles stick in both directions', () => {
  setCrossings(mixed)
  render(<BoundaryCrossingsPanel taskIdentifier='LUM-496' enabled />)

  fireEvent.click(screen.getByTestId('crossing-group-PROJECT_RULE_VIOLATION'))
  expect(screen.getByTestId('crossing-toggle-bc-rule-1')).toBeInTheDocument()

  // …and the default-expanded group can be closed.
  fireEvent.click(screen.getByTestId('crossing-group-DESTRUCTIVE_DB_COMMAND'))
  expect(screen.queryByTestId('crossing-toggle-bc-db')).toBeNull()
  expect(screen.getByTestId('crossing-toggle-bc-rule-1')).toBeInTheDocument()
})

it("subset='open' renders only undispositioned crossings under the open title", () => {
  setCrossings(mixed)
  render(
    <BoundaryCrossingsPanel taskIdentifier='LUM-496' enabled subset='open' />
  )

  expect(
    screen.getByText('3 open — blocks Done until dispositioned')
  ).toBeInTheDocument()
  expect(
    screen.getByText(/This task can't move to Done until each open crossing/)
  ).toBeInTheDocument()
  expect(screen.queryByTestId('crossing-group-SCOPE_EXPANSION')).toBeNull()
  expect(
    screen.getByTestId('crossing-group-PROJECT_RULE_VIOLATION')
  ).toHaveTextContent('2 open / 2')
})

it("subset='open' renders nothing when every crossing is dispositioned", () => {
  setCrossings([
    makeCrossing({ id: 'bc-done', disposition: 'FALSE_POSITIVE' }),
    makeCrossing({ id: 'bc-auto', disposition: 'AUTO_LEGIT' }),
  ])
  const { container } = render(
    <BoundaryCrossingsPanel taskIdentifier='LUM-496' enabled subset='open' />
  )
  expect(container).toBeEmptyDOMElement()
})

it("subset='dispositioned' renders only settled crossings, collapsed, with a count", () => {
  setCrossings(mixed)
  render(
    <BoundaryCrossingsPanel
      taskIdentifier='LUM-496'
      enabled
      subset='dispositioned'
    />
  )

  expect(
    screen.getByText('Boundary crossings · dispositioned')
  ).toBeInTheDocument()
  // One toggle for the whole panel, collapsed by default; the count is the
  // number of dispositioned crossings.
  const toggle = screen.getByTestId('boundary-summary-toggle')
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(toggle).toHaveTextContent('1')
  expect(
    screen.queryByText(/This task can't move to Done until each open crossing/)
  ).toBeNull()

  fireEvent.click(toggle)
  // Groups exist but every one of them starts folded in the record view.
  const scope = screen.getByTestId('crossing-group-SCOPE_EXPANSION')
  expect(scope).toHaveAttribute('aria-expanded', 'false')
  expect(
    screen.queryByTestId('crossing-group-DESTRUCTIVE_DB_COMMAND')
  ).toBeNull()

  fireEvent.click(scope)
  expect(screen.getByTestId('crossing-toggle-bc-done')).toBeInTheDocument()
})

it("subset='dispositioned' renders nothing when nothing has been dispositioned", () => {
  setCrossings([makeCrossing({ id: 'bc-open' })])
  const { container } = render(
    <BoundaryCrossingsPanel
      taskIdentifier='LUM-496'
      enabled
      subset='dispositioned'
    />
  )
  expect(container).toBeEmptyDOMElement()
})

it('anchorId overrides the default deep-link anchor', () => {
  setCrossings(mixed)
  render(
    <BoundaryCrossingsPanel
      taskIdentifier='LUM-496'
      enabled
      subset='open'
      anchorId='record-crossings'
    />
  )
  expect(document.getElementById('record-crossings')).toBeInTheDocument()
  expect(document.getElementById('boundary-crossings')).toBeNull()
})
