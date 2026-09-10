/** @jest-environment jsdom */
/**
 * LUM-496 Task 4 — the Run report KPI tiles. Mirrors
 * __tests__/components/TaskDetailTimeline/record-status-strip.test.tsx's
 * react-intl mock (real `{token}` substitution against `defaultMessage`, no
 * ICU plural needed here) so the tile copy renders exactly as it will in the
 * app, without needing a real IntlProvider (react-intl's ESM build isn't
 * loadable through jest here).
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

import { render, screen } from '@testing-library/react'
import { RunReportTiles } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RunReportTiles'
import type { RunReportTiles as RunReportTilesData } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/run-report-tiles'

function tiles(p: Partial<RunReportTilesData> = {}): RunReportTilesData {
  return {
    prIterations: null,
    passRateR1: null,
    costTokens: null,
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
})
