/** @jest-environment jsdom */

// Same react-intl mock shape as TokenCostBreakdown.test.tsx: interpolated
// defaultMessage with ICU plural handling, formatNumber = String(n).
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      d: { id?: string; defaultMessage?: string },
      values?: Record<string, string | number>
    ) => {
      let s = d.defaultMessage ?? d.id ?? ''
      if (values) {
        s = s.replace(
          /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
          (_: string, key: string, one: string, other: string) => {
            const n = Number(values[key] ?? 0)
            const branch = n === 1 ? one : other
            return branch.replace('#', String(n))
          }
        )
        for (const [k, v] of Object.entries(values)) {
          s = s.split(`{${k}}`).join(String(v))
        }
      }
      return s
    },
    formatNumber: (n: number) => String(n),
  }),
}))

const mockUseAgentRuns = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useAgentRuns', () => ({
  useAgentRuns: (...args: unknown[]) => mockUseAgentRuns(...args),
}))
// Run cards are out of scope here — their own suite covers them.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunCard',
  () => ({ AgentRunCard: () => null })
)

import { render, screen, fireEvent } from '@testing-library/react'
import { AgentRunTab } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunTab'
import type { ModelCost } from '@/app/workspace/[workspaceUrl]/types'

const opus: ModelCost = {
  model: 'claude-opus-4-8',
  input: 95,
  output: 180,
  cacheRead: 10_900_000,
  cacheCreation: 1_200_000,
  total: 12_300_000,
}
const sonnetLive: ModelCost = {
  model: 'claude-sonnet-4-6',
  input: 48,
  output: 92,
  cacheRead: 2_900_000,
  cacheCreation: 410_000,
  total: 3_300_000,
  inFlight: { input: 10, output: 5, cacheRead: 80, cacheCreation: 5, total: 100 },
}

function arm(byModel: ModelCost[]) {
  mockUseAgentRuns.mockReturnValue({
    data: {
      runs: [{ sessionId: 's1', runNumber: 1 }],
      totals: { runCount: 1, turnCount: 2, loopCount: 4, byModel },
      perMember: [],
    },
    loading: false,
    error: null,
  })
}

function renderTab() {
  return render(
    <AgentRunTab taskId='t1' taskIdentifier='LUM-351' enabled={true} />
  )
}

describe('AgentRunTab token usage card', () => {
  beforeEach(() => mockUseAgentRuns.mockReset())

  it('is collapsed by default: details out of the DOM, header summary carries title + per-model totals', () => {
    arm([opus, sonnetLive])
    renderTab()
    const toggle = screen.getByTestId('token-usage-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Token usage')).toBeInTheDocument()
    expect(screen.getByText('1 run · 2 turns · 2 models')).toBeInTheDocument()
    expect(
      screen.getByText('opus-4-8 12300000 · sonnet-4-6 3300000')
    ).toBeInTheDocument()
    // Breakdown details (segment rows) absent while collapsed.
    expect(screen.queryByText('output')).not.toBeInTheDocument()
    expect(screen.queryByText('cache-read')).not.toBeInTheDocument()
  })

  it('toggle expands to the full breakdown and collapses back', () => {
    arm([opus, sonnetLive])
    renderTab()
    const toggle = screen.getByTestId('token-usage-toggle')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    // Real TokenCostBreakdown renders one "output" row per model group (2 here).
    expect(screen.getAllByText('output').length).toBeGreaterThan(0)
    expect(screen.getByText('claude-opus-4-8')).toBeInTheDocument()
    // The shared breakdown renders without its own title (header carries it);
    // only the toggle button's "Token usage" label should be present.
    expect(screen.getAllByText('Token usage')).toHaveLength(1)
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('output')).not.toBeInTheDocument()
  })

  it('keeps a pulse indicator in the collapsed row while any model has in-flight burn', () => {
    arm([opus, sonnetLive])
    renderTab()
    expect(screen.getByTestId('collapsed-in-flight-dot')).toBeInTheDocument()
  })

  it('shows no in-flight indicator when all models are settled', () => {
    arm([opus])
    renderTab()
    expect(
      screen.queryByTestId('collapsed-in-flight-dot')
    ).not.toBeInTheDocument()
  })
})
