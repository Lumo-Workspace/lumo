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
  }),
}))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
  }: {
    href: string
    children: React.ReactNode
  }) => <a href={href}>{children}</a>,
}))

import { render, screen } from '@testing-library/react'
import { SessionsList } from '@/app/sessions/SessionsList'
import type { SessionListRow } from '@/lib/services/session-list.service'

const row = (over: Partial<SessionListRow> = {}): SessionListRow => ({
  id: 's1',
  cwd: '/repo',
  lastActivityAt: '2026-06-07T16:00:00.000Z',
  eventCount: 4,
  subagentCount: 0,
  taskCount: 0,
  ...over,
})

describe('SessionsList', () => {
  it('shows the subagent and task summary when the family has any', () => {
    render(<SessionsList rows={[row({ subagentCount: 2, taskCount: 3 })]} />)
    expect(screen.getByText('2 subagents · 3 tasks')).toBeInTheDocument()
  })

  it('shows no family summary when there are no subagents or tasks', () => {
    render(<SessionsList rows={[row()]} />)
    expect(screen.queryByText(/subagent/)).toBeNull()
    expect(screen.queryByText(/\btasks?\b/)).toBeNull()
  })

  it('shows the empty state when there are no sessions', () => {
    render(<SessionsList rows={[]} />)
    expect(screen.getByText(/No sessions yet/)).toBeInTheDocument()
  })

  it('shows the no-cwd placeholder and event count', () => {
    render(<SessionsList rows={[row({ cwd: null, eventCount: 1 })]} />)
    expect(screen.getByText('no cwd')).toBeInTheDocument()
    expect(screen.getByText('1 event')).toBeInTheDocument()
  })
})
