/** @jest-environment jsdom */
// LUM-644 — Overview 的 burn vs budget 呈现:tokens KPI 卡内预算行(用量/
// 未测/超限三态),超限时风险队列出现 advisory 告警行(含 burn/budget 数字,
// 纯提示不阻断);未设预算时两处均不渲染任何预算内容。

const messages: Record<string, string> = {
  'milestone.costTrend.budgetUsage': '{percent}% of {budget} token budget',
  'milestone.costTrend.budgetUnmeasured':
    'Token budget {budget} — burn not measured',
  'milestone.costTrend.budgetOver': 'Over budget by {over}',
  'milestone.riskQueue.budget.title': 'Token budget exceeded',
  'milestone.riskQueue.budget.count': 'burn {burn} of {budget} ({percent}%)',
  'milestone.riskQueue.budget.advisory':
    'Advisory only — nothing is blocked. Review the remaining scope or raise the budget.',
  'milestone.riskQueue.empty.title': 'Nothing pending',
  'milestone.costTrend.coverage': 'measured on {measured} of {total} tasks',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => {
      let msg = messages[id] ?? id
      for (const [k, v] of Object.entries(values ?? {})) {
        msg = msg.replace(`{${k}}`, String(v))
      }
      return msg
    },
  }),
}))

jest.mock('recharts', () => {
  const Original = jest.requireActual('recharts')
  const React = jest.requireActual('react')
  return {
    ...Original,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 500, height: 300 }),
  }
})

import { render, screen } from '@testing-library/react'
import { MilestoneCostTrendSection } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneCostTrendSection'
import { MilestoneRiskQueueSection } from '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneRiskQueueSection'
import type { ApiMilestone } from '@/lib/api-client/milestones'

const costRollup: NonNullable<ApiMilestone['costRollup']> = {
  tokenCost: 1_500_000,
  activeTimeSec: 600,
  measuredTasks: 2,
  totalTasks: 2,
}

const emptyRiskQueue: NonNullable<ApiMilestone['riskQueue']> = {
  blocked: [],
  awaitingVerdict: [],
  crossings: {
    known: true,
    bySeverity: { high: 0, medium: 0, low: 0 },
    tasks: [],
  },
  verifyEscalated: [],
  scopeBaseline: { initial: 2, current: 2, addedLater: 0 },
}

const exceededBudget: NonNullable<ApiMilestone['budget']> = {
  tokenBudget: 1_000_000,
  tokenCost: 1_500_000,
  usedRatio: 1.5,
  exceeded: true,
  overBy: 500_000,
}

describe('milestone token budget ui', () => {
  it('cost section renders burn vs budget with usage percent', () => {
    render(
      <MilestoneCostTrendSection
        costRollup={costRollup}
        budget={{
          tokenBudget: 2_000_000,
          tokenCost: 1_500_000,
          usedRatio: 0.75,
          exceeded: false,
          overBy: null,
        }}
        burnup={undefined}
        deliveryStats={null}
        memberDelivery={null}
      />
    )
    const line = screen.getByTestId('token-budget-line')
    expect(line).toHaveTextContent('75% of 2M token budget')
    // Under budget: no over-budget note.
    expect(screen.queryByTestId('token-budget-over')).toBeNull()
  })

  it('cost section states the over-budget amount when exceeded', () => {
    render(
      <MilestoneCostTrendSection
        costRollup={costRollup}
        budget={exceededBudget}
        burnup={undefined}
        deliveryStats={null}
        memberDelivery={null}
      />
    )
    expect(screen.getByTestId('token-budget-line')).toHaveTextContent(
      '150% of 1M token budget'
    )
    expect(screen.getByTestId('token-budget-over')).toHaveTextContent(
      'Over budget by 500K'
    )
  })

  it('cost section reads unmeasured burn as unknown — budget stated, no percent, no alert', () => {
    render(
      <MilestoneCostTrendSection
        costRollup={{ ...costRollup, tokenCost: null, measuredTasks: 0 }}
        budget={{
          tokenBudget: 2_000_000,
          tokenCost: null,
          usedRatio: null,
          exceeded: null,
          overBy: null,
        }}
        burnup={undefined}
        deliveryStats={null}
        memberDelivery={null}
      />
    )
    expect(screen.getByTestId('token-budget-line')).toHaveTextContent(
      'Token budget 2M — burn not measured'
    )
    expect(screen.queryByTestId('token-budget-over')).toBeNull()
  })

  it('cost section renders no budget content when no budget is set', () => {
    render(
      <MilestoneCostTrendSection
        costRollup={costRollup}
        budget={null}
        burnup={undefined}
        deliveryStats={null}
        memberDelivery={null}
      />
    )
    expect(screen.queryByTestId('token-budget-line')).toBeNull()
  })

  it('risk queue renders the advisory alert row with burn and budget numbers when exceeded', () => {
    render(
      <MilestoneRiskQueueSection
        riskQueue={emptyRiskQueue}
        budget={exceededBudget}
        workspaceUrl='w'
      />
    )
    const alert = screen.getByTestId('risk-queue-budget')
    expect(alert).toHaveTextContent('Token budget exceeded')
    expect(alert).toHaveTextContent('burn 1.5M of 1M (150%)')
    // Advisory copy — explicit "nothing is blocked", no gate anywhere.
    expect(alert).toHaveTextContent('nothing is blocked')
    // The alert counts as pending: the empty state must not show alongside it.
    expect(screen.queryByText('Nothing pending')).toBeNull()
  })

  it('risk queue renders no budget row when under budget, unknown, or unset', () => {
    for (const budget of [
      null,
      { ...exceededBudget, exceeded: false as const, overBy: null },
      {
        tokenBudget: 1_000_000,
        tokenCost: null,
        usedRatio: null,
        exceeded: null,
        overBy: null,
      },
    ]) {
      const { unmount } = render(
        <MilestoneRiskQueueSection
          riskQueue={emptyRiskQueue}
          budget={budget}
          workspaceUrl='w'
        />
      )
      expect(screen.queryByTestId('risk-queue-budget')).toBeNull()
      // A clear queue stays an explicit empty state.
      expect(screen.getByText('Nothing pending')).toBeInTheDocument()
      unmount()
    }
  })
})
