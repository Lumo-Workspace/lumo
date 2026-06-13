/** @jest-environment jsdom */

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
            return (n === 1 ? one : other).replace('#', String(n))
          }
        )
        for (const [k, v] of Object.entries(values))
          s = s.split(`{${k}}`).join(String(v))
      }
      return s
    },
    formatNumber: (n: number) => String(n),
  }),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { TokenUsageBreakdown } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/TokenUsageBreakdown'
import type {
  AgentRunMemberStat,
  ModelCost,
} from '@/app/workspace/[workspaceUrl]/types'

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
  inFlight: {
    input: 10,
    output: 5,
    cacheRead: 80,
    cacheCreation: 5,
    total: 100,
  },
}

function mem(id: string, name: string, total: number): AgentRunMemberStat {
  return {
    workspaceMemberId: id,
    clerkId: null,
    name,
    imageUrl: '',
    runCount: 1,
    turnCount: 1,
    loopCount: 1,
    byModel: [{ ...opus, total }],
  }
}

function totals(byModel: ModelCost[]) {
  return { runCount: 1, turnCount: 2, loopCount: 4, byModel }
}

describe('TokenUsageBreakdown', () => {
  it('is collapsed by default: details out of the DOM, header carries title + per-model totals', () => {
    render(
      <TokenUsageBreakdown totals={totals([opus, sonnetLive])} perMember={[]} />
    )
    const toggle = screen.getByTestId('token-usage-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Token usage')).toBeInTheDocument()
    expect(screen.getByText('1 run · 2 turns · 2 models')).toBeInTheDocument()
    expect(
      screen.getByText('opus-4-8 12300000 · sonnet-4-6 3300000')
    ).toBeInTheDocument()
    expect(screen.queryByText('output')).not.toBeInTheDocument()
  })

  it('toggle expands to the full per-model breakdown and collapses back', () => {
    render(
      <TokenUsageBreakdown totals={totals([opus, sonnetLive])} perMember={[]} />
    )
    const toggle = screen.getByTestId('token-usage-toggle')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByText('output').length).toBeGreaterThan(0)
    expect(screen.getByText('claude-opus-4-8')).toBeInTheDocument()
    expect(screen.getAllByText('Token usage')).toHaveLength(1)
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('output')).not.toBeInTheDocument()
  })

  it('keeps a pulse indicator while collapsed when any model has in-flight burn', () => {
    render(
      <TokenUsageBreakdown totals={totals([opus, sonnetLive])} perMember={[]} />
    )
    expect(screen.getByTestId('collapsed-in-flight-dot')).toBeInTheDocument()
  })

  it('shows no in-flight indicator when all models are settled', () => {
    render(<TokenUsageBreakdown totals={totals([opus])} perMember={[]} />)
    expect(
      screen.queryByTestId('collapsed-in-flight-dot')
    ).not.toBeInTheDocument()
  })

  it('shows the by-person summary when expanded and 2+ members contributed', () => {
    render(
      <TokenUsageBreakdown
        totals={totals([opus])}
        perMember={[mem('a', 'Ann', 9_000_000), mem('b', 'Bo', 3_300_000)]}
      />
    )
    fireEvent.click(screen.getByTestId('token-usage-toggle'))
    expect(screen.getByTestId('per-member-summary')).toBeInTheDocument()
    expect(screen.getByText('Ann')).toBeInTheDocument()
  })

  it('omits the by-person summary for a single member', () => {
    render(
      <TokenUsageBreakdown
        totals={totals([opus])}
        perMember={[mem('a', 'Ann', 12_300_000)]}
      />
    )
    fireEvent.click(screen.getByTestId('token-usage-toggle'))
    expect(screen.queryByTestId('per-member-summary')).not.toBeInTheDocument()
  })
})
