/** @jest-environment jsdom */

// Mock react-intl: returns interpolated defaultMessage. Plural messages of the
// form "{n, plural, one {# x} other {# y}}" pick a branch by value; bare {key}
// placeholders are substituted directly (matches the Chinese defaultMessages).
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
import { AgentRunMemberStats } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunMemberStats'
import type { AgentRunMemberStat } from '@/app/workspace/[workspaceUrl]/types'

const member = (over: Partial<AgentRunMemberStat>): AgentRunMemberStat => ({
  workspaceMemberId: 'm1',
  clerkId: 'c1',
  name: 'Ada Lovelace',
  imageUrl: '',
  runCount: 2,
  turnCount: 3,
  loopCount: 3,
  byModel: [
    {
      model: 'opus',
      input: 100,
      output: 50,
      cacheRead: 10,
      cacheCreation: 10,
      total: 170,
    },
  ],
  ...over,
})

describe('AgentRunMemberStats', () => {
  it('renders nothing when there are no members', () => {
    const { container } = render(<AgentRunMemberStats members={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a row per member with name and run/turn caption', () => {
    render(<AgentRunMemberStats members={[member({})]} />)
    expect(screen.getByTestId('agent-run-member-stats')).toBeInTheDocument()
    expect(screen.getByTestId('member-stat-m1')).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    // memberSummary defaultMessage: "{runs} 次运行 · {turns} 轮"
    expect(screen.getByText('2 次运行 · 3 轮')).toBeInTheDocument()
  })

  it('renders one row per distinct member', () => {
    render(
      <AgentRunMemberStats
        members={[
          member({ workspaceMemberId: 'm1', name: 'Ada' }),
          member({ workspaceMemberId: 'm2', name: 'Babbage' }),
        ]}
      />
    )
    expect(screen.getByTestId('member-stat-m1')).toBeInTheDocument()
    expect(screen.getByTestId('member-stat-m2')).toBeInTheDocument()
  })

  it('falls back to initials when no avatar image is present', () => {
    render(<AgentRunMemberStats members={[member({ name: 'Ada Lovelace' })]} />)
    expect(screen.getByText('AL')).toBeInTheDocument()
  })
})
