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

import { render, screen } from '@testing-library/react'
import { TokenCostBreakdown } from '@/app/workspace/[workspaceUrl]/components/TokenCostBreakdown'
import type { ModelCost } from '@/app/workspace/[workspaceUrl]/types'

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
})
