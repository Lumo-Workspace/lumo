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

describe('SettingsShell — nav', () => {
  it('no longer offers an Acceptance settings item (LUM-942)', () => {
    render(
      <SettingsShell workspaceUrl='acme' isOwner={true}>
        <div />
      </SettingsShell>
    )
    expect(
      screen.getByRole('link', { name: 'settings.workspace' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'settings.acceptance' })
    ).toBeNull()
  })
})
