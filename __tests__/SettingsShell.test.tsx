import { render, screen } from '@testing-library/react'
import { SettingsShell } from '@/app/workspace/[workspaceUrl]/settings/SettingsShell'

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/workspace/acme/settings/general',
}))

const mockHasPluginSlot = jest.fn((_name: string) => true)
jest.mock('@/lib/plugins/client', () => ({
  hasPluginSlot: (name: string) => mockHasPluginSlot(name),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

jest.mock('motion/react', () => ({
  motion: {
    div: ({
      children,
      className,
    }: {
      children: React.ReactNode
      className?: string
    }) => <div className={className}>{children}</div>,
  },
}))

describe('SettingsShell — nav', () => {
  it('no longer offers an Acceptance settings item (LUM-942)', () => {
    render(
      <SettingsShell workspaceUrl='acme' isOwner={true}>
        <div />
      </SettingsShell>
    )
    expect(
      screen.getByRole('link', { name: 'settings.general' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'settings.acceptance' })
    ).toBeNull()
  })

  it('no longer links Task templates for owners or members (LUM-974)', () => {
    for (const isOwner of [true, false]) {
      const { container, unmount } = render(
        <SettingsShell workspaceUrl='acme' isOwner={isOwner}>
          <div />
        </SettingsShell>
      )
      expect(
        container.querySelector('a[href$="/settings/task-templates"]')
      ).toBeNull()
      unmount()
    }
  })
})

// LUM-1339: five groups, one page per area.
describe('SettingsShell — grouped nav (LUM-1339)', () => {
  function navLinks() {
    return screen
      .getAllByRole('link')
      .slice(1) // "Back to app"
      .map(a =>
        a.getAttribute('href')!.replace('/workspace/acme/settings/', '')
      )
  }

  it('shows an owner all five groups in order, marking the open page', () => {
    render(
      <SettingsShell workspaceUrl='acme' isOwner={true}>
        <div />
      </SettingsShell>
    )
    expect(
      screen
        .getAllByText(/^settings\.(personal|workspace|group\.\w+)$/)
        .map(p => p.textContent)
    ).toEqual([
      'settings.personal',
      'settings.workspace',
      'settings.group.workflow',
      'settings.group.codeReview',
      'settings.group.dataSecurity',
    ])
    expect(navLinks()).toEqual([
      'account',
      'notifications',
      'connected-accounts',
      'developer',
      'general',
      'members',
      'integrations',
      'tags',
      'sprints',
      'done-requirements',
      'code-review',
      'code-review/repositories',
      'code-review/rules',
      'data-retention',
      'ai',
      'export',
      'audit-log',
      'trash',
    ])
    expect(
      screen.getByRole('link', { name: 'settings.general' })
    ).toHaveAttribute('aria-current', 'page')
    expect(mockHasPluginSlot).toHaveBeenCalledWith(
      'settings.codeReview.behavior'
    )
  })

  it('shows a member only the pages they could open before', () => {
    render(
      <SettingsShell workspaceUrl='acme' isOwner={false}>
        <div />
      </SettingsShell>
    )
    expect(navLinks()).toEqual([
      'account',
      'notifications',
      'connected-accounts',
      'developer',
      'members',
      'integrations',
      'tags',
      'trash',
    ])
    expect(screen.queryByText('settings.group.codeReview')).toBeNull()
  })

  it('drops the Code review group when the plugin is not installed', () => {
    mockHasPluginSlot.mockReturnValueOnce(false)
    render(
      <SettingsShell workspaceUrl='acme' isOwner={true}>
        <div />
      </SettingsShell>
    )
    expect(screen.queryByText('settings.group.codeReview')).toBeNull()
    expect(navLinks()).not.toContain('code-review')
  })
})
