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

// AgentBadge pulls @lobehub/icons (deep ESM import) which is noise for this
// test — stub it so we render only the run header.
jest.mock('@/app/workspace/[workspaceUrl]/components/AgentBadge', () => ({
  AgentBadge: () => null,
}))

import { render, screen } from '@testing-library/react'
import { AgentRunCard } from '@/app/workspace/[workspaceUrl]/components/AgentRunTimeline/AgentRunCard'
import type { AgentRunSession } from '@/app/workspace/[workspaceUrl]/types'

const baseRun = (over: Partial<AgentRunSession> = {}): AgentRunSession =>
  ({
    sessionId: 's1',
    agent: 'CLAUDE_CODE',
    runNumber: 1,
    startedAt: '2026-06-07T15:48:00Z',
    lastActivityAt: '2026-06-07T16:00:00Z',
    durationMs: 720_000,
    toolCallCount: 5,
    eventCount: 5,
    memoryCount: 0,
    cost: null,
    member: { workspaceMemberId: 'm1', name: 'Chao Li', imageUrl: '' },
    items: [],
    ...over,
  }) as AgentRunSession

describe('AgentRunCard — run-header attribution (LUM-308)', () => {
  it('shows the owning member name + avatar chip in the header', () => {
    render(<AgentRunCard run={baseRun()} />)
    expect(screen.getByTestId('run-member')).toBeInTheDocument()
    expect(screen.getByText('Chao Li')).toBeInTheDocument()
    // Avatar fallback initials.
    expect(screen.getByText('CL')).toBeInTheDocument()
  })

  it('omits the member chip for an orphan run with no member', () => {
    render(<AgentRunCard run={baseRun({ member: null })} />)
    expect(screen.queryByTestId('run-member')).not.toBeInTheDocument()
  })
})
