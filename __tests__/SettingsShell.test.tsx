import { render, screen } from '@testing-library/react'
import { SettingsShell } from '@/app/workspace/[workspaceUrl]/settings/SettingsShell'

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/workspace/acme/settings/workspace',
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
    div: ({
      children,
      className,
    }: {
      children: React.ReactNode
      className?: string
    }) => <div className={className}>{children}</div>,
  },
}))

describe('SettingsShell — acceptance settings nav (LUM-434)', () => {
  it('shows an OWNER-only Acceptance item linking to /settings/acceptance', () => {
    const { rerender } = render(
      <SettingsShell workspaceUrl='acme' isOwner={true}>
        <div />
      </SettingsShell>
    )
    const link = screen.getByRole('link', { name: 'settings.acceptance' })
    expect(link).toHaveAttribute('href', '/workspace/acme/settings/acceptance')

    // A non-owner (member nav) must not see the acceptance item.
    rerender(
      <SettingsShell workspaceUrl='acme' isOwner={false}>
        <div />
      </SettingsShell>
    )
    expect(
      screen.queryByRole('link', { name: 'settings.acceptance' })
    ).toBeNull()
  })
})
