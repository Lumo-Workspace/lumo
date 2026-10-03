/** @jest-environment jsdom */
/**
 * LUM-496 Task 4 — the Run report KPI tiles. Mirrors
 * __tests__/components/TaskDetailTimeline/record-status-strip.test.tsx's
 * react-intl mock (real `{token}` substitution against `defaultMessage`, no
 * ICU plural needed here) so the tile copy renders exactly as it will in the
 * app, without needing a real IntlProvider (react-intl's ESM build isn't
 * loadable through jest here).
 */
// `formatDurationSec` (the shared LUM-642 formatter the Cost tile's active-time
// caption reuses) reaches for the `duration.*` keys, which carry no
// defaultMessage — so the mock needs their en copy to render a real duration.
const mockDurationMessages: Record<string, string> = {
  'duration.hours': '{hours}h',
  'duration.minutes': '{minutes}m',
  'duration.seconds': '{seconds}s',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id, defaultMessage }: { id: string; defaultMessage?: string },
      values?: Record<string, unknown>
    ) => {
      let msg = defaultMessage ?? mockDurationMessages[id] ?? id
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.split(`{${k}}`).join(String(v))
      }
      return msg
    },
  }),
}))

import { render, screen } from '@testing-library/react'
import { RunReportTiles } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RunReportTiles'
import type { RunReportTiles as RunReportTilesData } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/run-report-tiles'

function tiles(p: Partial<RunReportTilesData> = {}): RunReportTilesData {
  return {
    prIterations: null,
    passRateR1: null,
    costTokens: null,
    activeTimeSec: null,
    rework: null,
    ...p,
  }
}

describe('RunReportTiles', () => {
  it('renders the four testids', () => {
    render(<RunReportTiles tiles={tiles()} />)
    expect(screen.getByTestId('tile-prIterations')).toBeInTheDocument()
    expect(screen.getByTestId('tile-passRateR1')).toBeInTheDocument()
    expect(screen.getByTestId('tile-costTokens')).toBeInTheDocument()
    expect(screen.getByTestId('tile-rework')).toBeInTheDocument()
  })

  it('renders the mockup example values', () => {
    render(
      <RunReportTiles
        tiles={tiles({
          prIterations: { count: 7, first: 940, last: 947 },
          passRateR1: 100,
          costTokens: 1_400_000_000,
          rework: 6,
        })}
      />
    )
    expect(screen.getByTestId('tile-prIterations')).toHaveTextContent('7')
    expect(screen.getByTestId('tile-prIterations')).toHaveTextContent(
      '#940–#947'
    )
    expect(screen.getByTestId('tile-passRateR1')).toHaveTextContent('100%')
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent('1.4B')
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent('tokens')
    expect(screen.getByTestId('tile-rework')).toHaveTextContent('6')
  })

  it("carries the active-time reading as the Cost tile's second sub-caption", () => {
    // LUM-560/LUM-642: the reading the old CostSection showed did not survive
    // as a tile of its own — it rides under the Cost value, formatted by the
    // one shared duration formatter (2m 14s), never a forked "134s".
    render(
      <RunReportTiles
        tiles={tiles({ costTokens: 12_000, activeTimeSec: 134 })}
      />
    )
    const tile = screen.getByTestId('tile-costTokens')
    expect(tile).toHaveTextContent('Active time')
    expect(tile).toHaveTextContent('2m 14s')
  })

  it('renders a measured zero active time, and omits it entirely when cost was never captured', () => {
    const { rerender } = render(
      <RunReportTiles tiles={tiles({ costTokens: null, activeTimeSec: 0 })} />
    )
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent(
      'Active time 0s'
    )

    // No cost view at all → nothing measured, so nothing claimed.
    rerender(<RunReportTiles tiles={tiles()} />)
    expect(screen.getByTestId('tile-costTokens')).not.toHaveTextContent(
      'Active time'
    )
  })

  it('renders a measured zero rework as "0", not "not recorded"', () => {
    render(<RunReportTiles tiles={tiles({ rework: 0 })} />)
    expect(screen.getByTestId('tile-rework')).toHaveTextContent('0')
    expect(screen.getByTestId('tile-rework')).not.toHaveTextContent(
      'not recorded'
    )
  })

  it('renders a measured zero cost as "0", not "not recorded"', () => {
    render(<RunReportTiles tiles={tiles({ costTokens: 0 })} />)
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent('0')
    expect(screen.getByTestId('tile-costTokens')).not.toHaveTextContent(
      'not recorded'
    )
  })

  it('renders "not recorded" for every null field, never a fabricated 0', () => {
    render(<RunReportTiles tiles={tiles()} />)
    expect(screen.getByTestId('tile-prIterations')).toHaveTextContent(
      'not recorded'
    )
    expect(screen.getByTestId('tile-passRateR1')).toHaveTextContent(
      'not recorded'
    )
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent(
      'not recorded'
    )
    expect(screen.getByTestId('tile-rework')).toHaveTextContent('not recorded')
    expect(screen.getByTestId('tile-prIterations')).not.toHaveTextContent('0')
    expect(screen.getByTestId('tile-passRateR1')).not.toHaveTextContent('0%')
    expect(screen.getByTestId('tile-rework')).not.toHaveTextContent('0')
  })

  it('omits the PR-range and tokens sub-captions when their tile is not measured', () => {
    render(<RunReportTiles tiles={tiles()} />)
    expect(screen.getByTestId('tile-prIterations')).not.toHaveTextContent('#')
    expect(screen.getByTestId('tile-costTokens')).not.toHaveTextContent(
      'tokens'
    )
  })

  it('renders the uppercase caption labels', () => {
    render(<RunReportTiles tiles={tiles()} />)
    expect(screen.getByTestId('tile-prIterations')).toHaveTextContent(
      'PR iterations'
    )
    expect(screen.getByTestId('tile-passRateR1')).toHaveTextContent(
      'Pass rate R1'
    )
    expect(screen.getByTestId('tile-costTokens')).toHaveTextContent('Cost')
    expect(screen.getByTestId('tile-rework')).toHaveTextContent('Rework')
  })

  it('shows the pre-dedupe warning on a measured cost tile (LUM-932)', () => {
    render(<RunReportTiles tiles={tiles({ costTokens: 5000 })} preDedupe />)
    expect(screen.getByTestId('cost-pre-dedupe')).toHaveTextContent(
      '≈2× overstated'
    )
  })

  it('omits the pre-dedupe warning by default or without a measured cost (LUM-932)', () => {
    const { rerender } = render(
      <RunReportTiles tiles={tiles({ costTokens: 5000 })} />
    )
    expect(screen.queryByTestId('cost-pre-dedupe')).toBeNull()
    rerender(<RunReportTiles tiles={tiles()} preDedupe />)
    expect(screen.queryByTestId('cost-pre-dedupe')).toBeNull()
  })
})
