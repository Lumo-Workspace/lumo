/** @jest-environment jsdom */
/**
 * LUM-780: an advisory crossing a SYSTEM re-judge produced says WHY under its
 * row — the evidence line — so "advisory" reads as a reasoned state, not a
 * silent downgrade. A row never re-judged renders no such line.
 *
 * Mocking style mirrors __tests__/boundary-crossings-panel-groups.test.tsx.
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
    category: 'POLICY_WEAKENING',
    detail:
      'The policy compiler stopped treating this rule as deterministic+blocking …',
    detectedAt: '2026-09-14T00:00:00.000Z',
    reversible: true,
    occurrenceCount: 1,
    lastSeenAt: '2026-09-14T00:00:00.000Z',
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
    advisory: true,
    policyRuleRef: 'abcd',
    policyRuleText: 'Never delete files in prisma/migrations/',
    agentContext: null,
    systemExplanation: null,
    rejudge: null,
    ...over,
  }
}

function setCrossings(crossings: unknown[]) {
  mockCrossings.mockReturnValue({
    crossings,
    gateEnabled: true,
    loading: false,
    error: null,
    refresh: jest.fn(),
  })
}

beforeEach(() => jest.clearAllMocks())
afterEach(cleanup)

test('a re-judged advisory crossing shows the re-judge evidence under its row; an un-re-judged one does not', () => {
  setCrossings([
    makeCrossing({
      id: 'bc-rejudged',
      rejudge: {
        reason: 'RULE_TEXT_PRESENT',
        evidence:
          'rule text is still in the current CLAUDE.md/AGENTS.md source: "Never delete files in prisma/migrations/"',
        criterionVersion: 'lum770-text-presence',
        at: '2026-09-14T01:00:00.000Z',
      },
    }),
    makeCrossing({ id: 'bc-plain' }),
    // An older server response carries no `rejudge` field at all.
    makeCrossing({ id: 'bc-legacy', rejudge: undefined }),
  ])
  render(<BoundaryCrossingsPanel taskIdentifier='LUM-780' enabled />)
  // An advisory-only group starts folded (nothing in it blocks Done); open the
  // group — open rows themselves start expanded, so their detail is mounted.
  fireEvent.click(screen.getByTestId('crossing-group-POLICY_WEAKENING'))

  const line = screen.getByTestId('boundary-rejudged-bc-rejudged')
  expect(line).toHaveTextContent('Re-judged by the system')
  expect(line).toHaveTextContent('no longer blocks Done')
  expect(line).toHaveTextContent(
    'rule text is still in the current CLAUDE.md/AGENTS.md source'
  )
  expect(screen.queryByTestId('boundary-rejudged-bc-plain')).toBeNull()
  expect(screen.queryByTestId('boundary-rejudged-bc-legacy')).toBeNull()
})
