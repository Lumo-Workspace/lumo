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

import { render, screen, fireEvent } from '@testing-library/react'
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

  it('shows no loop chip when loopCount is null (LUM-313 — absence is silent)', () => {
    render(
      <TokenCostBreakdown
        variant='full'
        models={[{ ...opus, model: '' }]}
        loopCount={null}
      />
    )
    // Never a "loops n/a" pill — it read as a contradiction next to the
    // header's turn count. With a single model and no chips, the whole
    // footer row is omitted, so no loop text appears at all.
    expect(screen.queryByText('loops n/a')).not.toBeInTheDocument()
    expect(screen.queryByText(/loop/)).not.toBeInTheDocument()
  })

  it('labels the section "Token usage" by default, without the uppercase micro-label style', () => {
    render(<TokenCostBreakdown variant='full' models={[opus]} loopCount={1} />)
    const title = screen.getByText('Token usage')
    expect(title).toBeInTheDocument()
    expect(title).not.toHaveClass('uppercase')
    expect(screen.queryByText('Cost')).not.toBeInTheDocument()
  })

  it('hides the title when showTitle is false (consumer header carries it)', () => {
    render(
      <TokenCostBreakdown
        variant='full'
        models={[opus]}
        loopCount={1}
        showTitle={false}
      />
    )
    expect(screen.queryByText('Token usage')).not.toBeInTheDocument()
  })

  it('separates multi-model groups with whitespace, not border-t dividers', () => {
    const { container } = render(
      <TokenCostBreakdown
        variant='full'
        models={[opus, sonnet]}
        loopCount={null}
      />
    )
    expect(container.querySelector('.border-t')).toBeNull()
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
  })

  it('renders the empty state when models is empty', () => {
    render(<TokenCostBreakdown variant='full' models={[]} loopCount={null} />)
    expect(
      screen.getByText('No captured cost on this trail')
    ).toBeInTheDocument()
  })
})

describe('collapsibleDetails mode', () => {
  it('defaults to four detail rows visible when collapsibleDetails is absent', () => {
    render(
      <TokenCostBreakdown variant='full' models={[opus]} loopCount={null} />
    )
    expect(screen.getByText('output')).toBeInTheDocument()
    expect(screen.getByText('cache-read')).toBeInTheDocument()
  })

  it('hides the four detail rows by default and reveals them on per-model toggle', () => {
    render(
      <TokenCostBreakdown
        variant='full'
        models={[opus]}
        loopCount={null}
        collapsibleDetails
      />
    )
    expect(screen.queryByText('output')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /claude-opus-4-8/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('output')).toBeInTheDocument()
  })

  it('keeps the segmented bar rendered while collapsed', () => {
    const { container } = render(
      <TokenCostBreakdown
        variant='full'
        models={[opus]}
        loopCount={null}
        collapsibleDetails
      />
    )
    expect(
      container.querySelector('[data-testid="cost-bar"]')
    ).toBeInTheDocument()
  })

  it('renders a custom rowHeader in place of the model name', () => {
    render(
      <TokenCostBreakdown
        variant='full'
        models={[opus]}
        loopCount={null}
        collapsibleDetails
        rowHeader={() => <span>Ada Lovelace</span>}
      />
    )
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.queryByText('claude-opus-4-8')).not.toBeInTheDocument()
  })

  it('TokenCostBreakdown multi-model footer omits turns chip and cross-model warning', () => {
    // LUM-525: the per-model "N turns" chip and the "not price-comparable ·
    // no total" warning were both removed from the footer. Render the
    // multi-model case (where the warning previously appeared) and assert
    // neither survives.
    render(
      <TokenCostBreakdown
        variant='full'
        models={[opus, sonnet]}
        loopCount={null}
      />
    )
    expect(screen.queryByText(/turn/)).not.toBeInTheDocument()
    expect(
      screen.queryByText('models not price-comparable · no total')
    ).not.toBeInTheDocument()
  })
})

describe('in-flight sentinel row (LUM-345)', () => {
  const inFlight: ModelCost = {
    model: '__in_flight__',
    input: 1000,
    output: 500,
    cacheRead: 9000,
    cacheCreation: 100,
    total: 10600,
  }

  it('renders the sentinel as a translated state label, never the raw key', () => {
    render(<TokenCostBreakdown variant='full' models={[inFlight]} />)
    expect(screen.getByText('in progress')).toBeInTheDocument()
    expect(screen.queryByText('__in_flight__')).not.toBeInTheDocument()
  })

  it('renders alongside a real model group', () => {
    render(<TokenCostBreakdown variant='full' models={[opus, inFlight]} />)
    expect(screen.getByText('claude-opus-4-8')).toBeInTheDocument()
    expect(screen.getByText('in progress')).toBeInTheDocument()
  })
})

describe('per-model in-flight share (LUM-345 follow-up)', () => {
  const liveOpus: ModelCost = {
    model: 'claude-opus-4-8',
    input: 150,
    output: 80,
    cacheRead: 40,
    cacheCreation: 30,
    total: 300,
    inFlight: {
      input: 50,
      output: 30,
      cacheRead: 30,
      cacheCreation: 20,
      total: 130,
    },
  }

  it('annotates a row carrying in-flight burn with the provisional share', () => {
    render(<TokenCostBreakdown variant='full' models={[liveOpus]} />)
    expect(screen.getByText('claude-opus-4-8')).toBeInTheDocument()
    expect(screen.getByText(/incl\. 130 in flight/)).toBeInTheDocument()
  })

  it('renders a provisional bar segment sized to the in-flight share', () => {
    render(<TokenCostBreakdown variant='full' models={[liveOpus]} />)
    const seg = screen.getByTestId('in-flight-segment')
    expect(seg.style.width).toBe(`${(130 / 300) * 100}%`)
  })

  it('shows neither annotation nor provisional segment on settled rows', () => {
    render(<TokenCostBreakdown variant='full' models={[opus]} />)
    expect(screen.queryByText(/in flight/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('in-flight-segment')).not.toBeInTheDocument()
  })
})
