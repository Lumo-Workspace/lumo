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

import { render, screen } from '@testing-library/react'
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
const sonnet: ModelCost = {
  model: 'claude-sonnet-4-6',
  input: 48,
  output: 92,
  cacheRead: 2_900_000,
  cacheCreation: 410_000,
  total: 3_300_000,
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

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (typeof global.ResizeObserver === 'undefined') {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

describe('TokenUsageBreakdown', () => {
  it('renders the per-model breakdown without an outer collapse or duplicate title', () => {
    render(<TokenUsageBreakdown totals={totals([opus, sonnet])} perMember={[]} />)
    expect(screen.getByText('claude-opus-4-8')).toBeInTheDocument()
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument()
    expect(screen.queryByText('Token usage')).not.toBeInTheDocument()
    expect(screen.queryByTestId('token-usage-toggle')).not.toBeInTheDocument()
  })

  it('shows a turns chip in the by-model footer', () => {
    render(<TokenUsageBreakdown totals={totals([opus, sonnet])} perMember={[]} />)
    expect(screen.getByText('2 turns')).toBeInTheDocument()
  })

  it('omits by-member / by-model group labels for a single contributor', () => {
    render(<TokenUsageBreakdown totals={totals([opus])} perMember={[mem('mA', 'Ada', 100)]} />)
    expect(screen.queryByText('By member')).not.toBeInTheDocument()
    expect(screen.queryByText('By model')).not.toBeInTheDocument()
  })

  it('renders by-member and by-model groups when 2+ members contributed', () => {
    render(
      <TokenUsageBreakdown
        totals={totals([opus, sonnet])}
        perMember={[mem('mA', 'Ada', 9_000_000), mem('mB', 'Bo', 3_000_000)]}
      />
    )
    expect(screen.getByText('By member')).toBeInTheDocument()
    expect(screen.getByText('By model')).toBeInTheDocument()
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('Bo')).toBeInTheDocument()
    // the by-model group (2 models) shows the no-total warning once;
    // the by-member group must NOT (members are summable)
    expect(screen.getAllByText('models not price-comparable · no total')).toHaveLength(1)
  })
})
