/**
 * @jest-environment jsdom
 *
 * LUM-907 PR2 — settings → Audit log: the table, actor labels, expandable
 * details, "Load more", the CSV link carrying the filters, the owner-only
 * and empty states; and the nav item only owners get.
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  const intl = {
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => {
      let raw = messages[id] ?? id
      for (const [k, v] of Object.entries(values ?? {}))
        raw = raw.split(`{${k}}`).join(String(v))
      return raw
    },
    formatNumber: (n: number) => String(n),
    formatDate: (d: string) => `date:${d}`,
  }
  return { useIntl: () => intl }
})

const mockUseAuditEvents = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useAuditEvents', () => ({
  useAuditEvents: (...a: unknown[]) => mockUseAuditEvents(...a),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMembers', () => ({
  useMembers: () => ({
    members: [{ id: 'm_1', clerkId: 'user_1', name: 'Alice Chen' }],
  }),
}))
jest.mock('next/navigation', () => ({
  usePathname: () => '/workspace/acme/settings/audit-log',
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
jest.mock('motion/react', () => ({
  motion: {
    div: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  },
}))

import { AuditLogSettingsPage } from '@/app/workspace/[workspaceUrl]/components/pages/AuditLogSettingsPage'
import { SettingsShell } from '@/app/workspace/[workspaceUrl]/settings/SettingsShell'
import type { AuditEventView } from '@/lib/audit/query'

const member: AuditEventView = {
  id: 'ev_1',
  createdAt: '2026-10-04T12:00:00.000Z',
  action: 'invite.created',
  actorType: 'MEMBER',
  actorId: 'user_1',
  actorMemberId: 'm_1',
  actorName: 'Alice Chen',
  actorEmail: 'alice@example.com',
  source: 'CLI',
  targetType: 'invite',
  targetId: 'inv_1',
  ip: '203.0.113.9',
  userAgent: 'lumo-cli/1.93.0',
  metadata: { email: 'bob@example.com', role: 'MEMBER' },
}
const system: AuditEventView = {
  ...member,
  id: 'ev_2',
  action: 'github_app.uninstalled',
  actorType: 'SYSTEM',
  actorId: null,
  actorMemberId: null,
  actorName: null,
  actorEmail: null,
  source: 'SYSTEM',
  targetType: 'integration',
  targetId: null,
  ip: null,
  userAgent: null,
  metadata: null,
}

function state(over: Record<string, unknown> = {}) {
  return {
    events: [member, system],
    isLoading: false,
    isError: false,
    forbidden: false,
    hasMore: false,
    isLoadingMore: false,
    loadMore: jest.fn(),
    ...over,
  }
}

beforeEach(() => {
  mockUseAuditEvents.mockReset()
})

describe('LUM-907 audit log settings page', () => {
  it('audit settings page: renders events with actor, action, target, source and IP', () => {
    mockUseAuditEvents.mockReturnValue(state())
    render(<AuditLogSettingsPage />)
    expect(
      screen.getByRole('heading', { name: 'Audit log' })
    ).toBeInTheDocument()
    expect(screen.getByText(/kept for 365 days/)).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    // header + two events
    expect(rows).toHaveLength(3)
    const first = within(rows[1]!)
    first.getByText('Alice Chen')
    first.getByText('invite.created')
    first.getByText('invite · inv_1')
    first.getByText('CLI / API')
    first.getByText('203.0.113.9')
    const second = within(rows[2]!)
    second.getAllByText('System')
    second.getByText('github_app.uninstalled')
  })

  it('audit settings page: a row expands to show email, user agent and metadata', () => {
    mockUseAuditEvents.mockReturnValue(state())
    render(<AuditLogSettingsPage />)
    expect(screen.queryByText('lumo-cli/1.93.0')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Show details' })[0]!)
    expect(screen.getByText('lumo-cli/1.93.0')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText(/"email": "bob@example.com"/)).toBeInTheDocument()
  })

  it('audit settings page: date filters re-query and flow into the CSV link', () => {
    mockUseAuditEvents.mockReturnValue(state())
    const { container } = render(<AuditLogSettingsPage />)
    const link = screen.getByRole('link', { name: /Export CSV/ })
    expect(link).toHaveAttribute(
      'href',
      '/api/workspaces/me/audit-events/export'
    )
    const [from, to] = Array.from(
      container.querySelectorAll('input[type="date"]')
    ) as HTMLInputElement[]
    fireEvent.change(from!, { target: { value: '2026-10-01' } })
    fireEvent.change(to!, { target: { value: '2026-10-04' } })
    expect(link).toHaveAttribute(
      'href',
      '/api/workspaces/me/audit-events/export?since=2026-10-01&until=2026-10-04'
    )
    expect(mockUseAuditEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ since: '2026-10-01', until: '2026-10-04' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(link).toHaveAttribute(
      'href',
      '/api/workspaces/me/audit-events/export'
    )
  })

  it('audit settings page: Load more fetches the next page', () => {
    const s = state({ hasMore: true })
    mockUseAuditEvents.mockReturnValue(s)
    render(<AuditLogSettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(s.loadMore).toHaveBeenCalled()
  })

  it('audit settings page: owner-only and empty states', () => {
    mockUseAuditEvents.mockReturnValue(state({ events: [], forbidden: true }))
    const { unmount } = render(<AuditLogSettingsPage />)
    expect(
      screen.getByText('Only workspace owners can view the audit log.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Export CSV/ })).toBeNull()
    unmount()
    mockUseAuditEvents.mockReturnValue(state({ events: [] }))
    render(<AuditLogSettingsPage />)
    expect(
      screen.getByText('No audit events match these filters.')
    ).toBeInTheDocument()
  })

  it('audit settings page: only owners get the Audit log nav item', () => {
    for (const isOwner of [true, false]) {
      const { container, unmount } = render(
        <SettingsShell workspaceUrl='acme' isOwner={isOwner}>
          <div />
        </SettingsShell>
      )
      expect(
        container.querySelector('a[href="/workspace/acme/settings/audit-log"]')
          ?.textContent ?? null
      ).toBe(isOwner ? 'Audit log' : null)
      unmount()
    }
  })
})
