/** @jest-environment jsdom */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
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
        for (const [k, v] of Object.entries(values)) {
          s = s.split(`{${k}}`).join(String(v))
        }
      }
      return s
    },
    formatNumber: (n: number) => String(n),
  }),
}))

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { AttributionSummary } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AttributionSummary'
import { RunReportTiles } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RunReportTiles'
import type { RunReportTiles as RunReportTilesData } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/run-report-tiles'

const tilesData = (
  over: Partial<RunReportTilesData> = {}
): RunReportTilesData => ({
  prIterations: null,
  passRateR1: null,
  costTokens: 12345,
  activeTimeSec: 60,
  rework: 0,
  ...over,
})

describe('flags auto-detected work as approximate', () => {
  it('shows the mixed summary and the approximate notice', () => {
    render(
      <AttributionSummary
        summary={{ explicit: 3, inferred: 1, approximate: true }}
      />
    )
    const root = screen.getByTestId('attribution-summary')
    expect(root).toHaveTextContent('3 sessions bound')
    expect(root).toHaveTextContent('1 auto-detected')
    expect(screen.getByTestId('attribution-approximate-notice')).toBeVisible()
  })

  it('shows the all-bound line and no notice when everything is bound', () => {
    render(
      <AttributionSummary
        summary={{ explicit: 2, inferred: 0, approximate: false }}
      />
    )
    expect(screen.getByTestId('attribution-summary')).toHaveTextContent(
      'all bound with lumo session attach'
    )
    expect(
      screen.queryByTestId('attribution-approximate-notice')
    ).not.toBeInTheDocument()
  })

  it('marks the cost tile approximate when asked and a cost exists', () => {
    render(<RunReportTiles tiles={tilesData()} costApproximate />)
    expect(screen.getByTestId('cost-approximate')).toHaveTextContent(
      'Includes auto-detected work'
    )
  })

  it('does not mark the cost tile without the flag', () => {
    render(<RunReportTiles tiles={tilesData()} />)
    expect(screen.queryByTestId('cost-approximate')).not.toBeInTheDocument()
  })

  it('does not mark the cost tile when no cost was measured', () => {
    render(
      <RunReportTiles
        tiles={tilesData({ costTokens: null, activeTimeSec: null })}
        costApproximate
      />
    )
    expect(screen.queryByTestId('cost-approximate')).not.toBeInTheDocument()
  })
})

describe('AttributionSummary with no runs', () => {
  it('renders nothing when there is no attributed work', () => {
    const { container } = render(
      <AttributionSummary
        summary={{ explicit: 0, inferred: 0, approximate: false }}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
