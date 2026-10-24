/** @jest-environment jsdom */

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      d: { id?: string; defaultMessage?: string },
      values?: Record<string, string | number>
    ) => {
      let s = d.defaultMessage ?? d.id ?? ''
      if (values)
        for (const [k, v] of Object.entries(values))
          s = s.split(`{${k}}`).join(String(v))
      return s
    },
    formatNumber: (n: number) => String(n),
  }),
}))

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/TokenUsageBreakdown',
  () => ({
    TokenUsageBreakdown: () => <div data-testid='token-breakdown' />,
  })
)

import { render, screen } from '@testing-library/react'
import { TokenUsageSection } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/TokenUsageSection'
import type { AgentRunTimelineResponse } from '@/app/workspace/[workspaceUrl]/types'

const opus = {
  model: 'claude-opus-4-8',
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheCreation: 0,
  total: 100,
}

function data(
  runs: number,
  byModel: (typeof opus)[]
): AgentRunTimelineResponse {
  return {
    runs: Array.from({ length: runs }, (_, i) => ({
      sessionId: `s${i}`,
      runNumber: i + 1,
    })) as unknown as AgentRunTimelineResponse['runs'],
    totals: { runCount: runs, loopCount: runs, byModel },
    perMember: [],
  }
}

describe('TokenUsageSection', () => {
  it('shows a skeleton with an sr-only label while loading with no data', () => {
    render(
      <TokenUsageSection
        data={undefined}
        loading={true}
        error={null}
        taskIdentifier='LUM-1'
      />
    )
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('agentRun.loading')).toHaveClass('sr-only')
    expect(screen.getByTestId('row-list-skeleton')).toBeInTheDocument()
  })

  it('shows the error line on error', () => {
    render(
      <TokenUsageSection
        data={undefined}
        loading={false}
        error='boom'
        taskIdentifier='LUM-1'
      />
    )
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('shows the empty hint when there are no runs', () => {
    render(
      <TokenUsageSection
        data={data(0, [])}
        loading={false}
        error={null}
        taskIdentifier='LUM-1'
      />
    )
    expect(screen.getByText('此任务还没有 Agent 运行记录')).toBeInTheDocument()
    expect(screen.queryByTestId('token-breakdown')).not.toBeInTheDocument()
  })

  it('renders the breakdown when runs carry model usage', () => {
    render(
      <TokenUsageSection
        data={data(1, [opus])}
        loading={false}
        error={null}
        taskIdentifier='LUM-1'
      />
    )
    expect(screen.getByTestId('token-breakdown')).toBeInTheDocument()
  })

  it('renders nothing when runs exist but no model usage was captured', () => {
    const { container } = render(
      <TokenUsageSection
        data={data(1, [])}
        loading={false}
        error={null}
        taskIdentifier='LUM-1'
      />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
