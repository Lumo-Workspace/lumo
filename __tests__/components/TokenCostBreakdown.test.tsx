/** @jest-environment jsdom */

// Mock react-intl: returns interpolated defaultMessage. Plural messages of the
// form "{n, plural, one {# loop} other {# loops}}" are handled by picking the
// "other" branch and substituting #.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      d: { id?: string; defaultMessage?: string },
      values?: Record<string, string | number>
    ) => {
      let s = d.defaultMessage ?? d.id ?? ''
      if (values) {
        // Handle ICU plural: "{key, plural, one {singular} other {plural}}"
        // by picking the matching branch based on the value.
        s = s.replace(
          /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g,
          (_: string, key: string, one: string, other: string) => {
            const n = Number(values[key] ?? 0)
            const branch = n === 1 ? one : other
            return branch.replace('#', String(n))
          }
        )
        // Simple {key} substitution for remaining values.
        for (const [k, v] of Object.entries(values)) {
          s = s.split(`{${k}}`).join(String(v))
        }
      }
      return s
    },
    formatNumber: (n: number) => String(n),
  }),
}))

import { render, screen, fireEvent, within } from '@testing-library/react'
import {
  TokenCostBreakdown,
  memberBreakdownFor,
} from '@/app/workspace/[workspaceUrl]/components/TokenCostBreakdown'
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

// Two members whose per-kind values sum to the opus aggregate (output 120+60
// = 180), so the expanded breakdown demonstrably reconciles with the line.
const ada: AgentRunMemberStat = {
  workspaceMemberId: 'mA',
  clerkId: 'cA',
  name: 'Ada',
  imageUrl: '',
  runCount: 1,
  turnCount: 1,
  loopCount: 0,
  byModel: [
    {
      model: 'claude-opus-4-8',
      input: 60,
      output: 120,
      cacheRead: 7_000_000,
      cacheCreation: 800_000,
      total: 7_860_180,
    },
  ],
}
const babbage: AgentRunMemberStat = {
  workspaceMemberId: 'mB',
  clerkId: 'cB',
  name: 'Babbage',
  imageUrl: '',
  runCount: 1,
  turnCount: 1,
  loopCount: 0,
  byModel: [
    {
      model: 'claude-opus-4-8',
      input: 35,
      output: 60,
      cacheRead: 3_900_000,
      cacheCreation: 400_000,
      total: 4_439_095,
    },
  ],
}

describe('TokenCostBreakdown', () => {
  it('renders a single unnamed group with real loops (no model name when empty)', () => {
    render(
      <TokenCostBreakdown
        variant='full'
        models={[{ ...opus, model: '' }]}
        loopCount={18}
      />
    )
    expect(screen.getByText('18 loops')).toBeInTheDocument()
    expect(screen.queryByText('claude-opus-4-8')).not.toBeInTheDocument()
    expect(screen.queryByText('loops n/a')).not.toBeInTheDocument()
  })

  it('renders "loops n/a" when loopCount is null (lineage path)', () => {
    render(
      <TokenCostBreakdown
        variant='full'
        models={[{ ...opus, model: '' }]}
        loopCount={null}
      />
    )
    expect(screen.getByText('loops n/a')).toBeInTheDocument()
  })

  it('stacks per-model groups with NO cross-model total when multi-model', () => {
    render(
      <TokenCostBreakdown
        variant='full'
        models={[opus, sonnet]}
        loopCount={18}
      />
    )
    expect(screen.getByText('claude-opus-4-8')).toBeInTheDocument()
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument()
    expect(
      screen.getByText('models not price-comparable · no total')
    ).toBeInTheDocument()
  })

  it('renders the empty state when models is empty', () => {
    render(<TokenCostBreakdown variant='full' models={[]} loopCount={null} />)
    expect(
      screen.getByText('No captured cost on this trail')
    ).toBeInTheDocument()
  })

  describe('per-person expandable rows (LUM-308)', () => {
    it('keeps rows non-expandable when no perMember is passed', () => {
      render(
        <TokenCostBreakdown variant='compact' models={[opus]} loopCount={1} />
      )
      expect(screen.queryByTestId('cost-line-output')).not.toBeInTheDocument()
    })

    it('keeps rows non-expandable for a single contributor', () => {
      render(
        <TokenCostBreakdown
          variant='full'
          models={[opus]}
          loopCount={1}
          perMember={[ada]}
        />
      )
      expect(screen.queryByTestId('cost-line-output')).not.toBeInTheDocument()
    })

    it('expands a line into a per-member breakdown that reconciles with the line total', () => {
      render(
        <TokenCostBreakdown
          variant='full'
          models={[opus]}
          loopCount={1}
          perMember={[ada, babbage]}
        />
      )

      const line = screen.getByTestId('cost-line-output')
      expect(line).toHaveAttribute('aria-expanded', 'false')
      // The aggregate output value is shown on the line.
      expect(within(line).getByText('180')).toBeInTheDocument()
      // Breakdown hidden until the line is clicked.
      expect(
        screen.queryByTestId('cost-breakdown-output')
      ).not.toBeInTheDocument()

      fireEvent.click(line)

      expect(line).toHaveAttribute('aria-expanded', 'true')
      const bd = screen.getByTestId('cost-breakdown-output')
      expect(within(bd).getByText('Ada')).toBeInTheDocument()
      expect(within(bd).getByText('Babbage')).toBeInTheDocument()
      // 120 + 60 = 180, the line aggregate.
      expect(within(bd).getByText('120')).toBeInTheDocument()
      expect(within(bd).getByText('60')).toBeInTheDocument()

      // Toggling collapses it again.
      fireEvent.click(line)
      expect(
        screen.queryByTestId('cost-breakdown-output')
      ).not.toBeInTheDocument()
    })
  })
})

describe('memberBreakdownFor', () => {
  it('returns contributing members for one (model, kind) cell, biggest first', () => {
    const rows = memberBreakdownFor([babbage, ada], 'claude-opus-4-8', 'output')
    expect(rows.map(r => r.name)).toEqual(['Ada', 'Babbage'])
    expect(rows.map(r => r.value)).toEqual([120, 60])
    expect(rows.reduce((n, r) => n + r.value, 0)).toBe(opus.output)
  })

  it('drops members with no value for the cell and members of other models', () => {
    const rows = memberBreakdownFor([ada, babbage], 'claude-sonnet-4-6', 'input')
    expect(rows).toEqual([])
  })
})
