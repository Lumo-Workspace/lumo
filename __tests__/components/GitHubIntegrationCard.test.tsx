/** @jest-environment jsdom */

/**
 * GitHubIntegrationCard is the TEAM GitHub card and shows the App
 * installation only, in the same shape as the Slack card: status dot in the
 * header, collapsible body, Uninstall in the overflow (⋯) menu.
 * - non-owners get no Install button and no overflow menu;
 * - an un-installed App says security scanning is not enabled;
 * - "connected" reported to the page means "installed".
 * A member's own GitHub login is a PERSONAL card and never appears here.
 */
const messages: Record<string, string> = {
  'github.title': 'GitHub',
  'github.description': 'desc',
  'github.appInstalled': 'Installed',
  'github.appAccount': 'Installed on {account}',
  'github.installApp': 'Install',
  'github.uninstallApp': 'Uninstall',
  'github.scanDisabled': 'Security scanning is not enabled',
  'github.scanDisabledDesc': 'Install the App',
  'github.uninstallTitle': 'Uninstall the GitHub App?',
  'github.uninstallDesc': 'Lumo will no longer scan this workspace.',
  'github.appRepos': 'Repositories the App can reach',
  'github.appNoRepos': 'No repositories selected',
  'github.manageOnGithub': 'Manage on GitHub',
  'common.cancel': 'Cancel',
  'common.moreOptions': 'More options',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, string>
    ) => {
      const raw = messages[id] ?? id
      return values ? raw.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '') : raw
    },
  }),
}))

const mockAppHook = {
  status: null as null | {
    installed: boolean
    accountLogin?: string | null
    repositories?: string[]
  },
  loading: false,
  uninstallOpen: false,
  setUninstallOpen: jest.fn(),
  uninstalling: false,
  handleInstall: jest.fn(),
  handleUninstall: jest.fn(),
}

jest.mock(
  '@/app/workspace/[workspaceUrl]/hooks/useGitHubAppInstallation',
  () => ({ useGitHubAppInstallation: () => mockAppHook })
)

import { render, screen, fireEvent } from '@testing-library/react'
import { GitHubIntegrationCard } from '@/app/workspace/[workspaceUrl]/components/GitHubIntegrationCard'

function expandBody() {
  // Two buttons carry aria-expanded=false (the ⋯ menu trigger and the
  // chevron toggle); the chevron is the one without aria-haspopup.
  const chevron = screen
    .getAllByRole('button', { expanded: false })
    .find(b => !b.hasAttribute('aria-haspopup'))
  fireEvent.click(chevron!)
}

describe('GitHubIntegrationCard (team: App installation, Slack-shaped)', () => {
  beforeEach(() => {
    mockAppHook.status = null
    mockAppHook.loading = false
    jest.clearAllMocks()
  })

  it('shows a status dot, a collapsible body and Uninstall in the menu once installed', () => {
    mockAppHook.status = {
      installed: true,
      accountLogin: 'acme-inc',
      repositories: ['acme-inc/web'],
    }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)

    // Header: dot, no Install button, no inline Uninstall.
    expect(screen.getByText('Installed on acme-inc')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Install$|Uninstall/ })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'More options' })
    ).toBeInTheDocument()

    // Body is collapsed until the chevron is clicked.
    expect(screen.queryByText('acme-inc/web')).not.toBeInTheDocument()
    expandBody()
    expect(screen.getByText('acme-inc/web')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Manage on GitHub/ })
    ).toHaveAttribute('href', 'https://github.com/settings/installations')
  })

  it('offers Install in the header and says scanning is not enabled while missing', () => {
    mockAppHook.status = { installed: false }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)

    expect(
      screen.getByText('Security scanning is not enabled')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(mockAppHook.handleInstall).toHaveBeenCalled()
    // Nothing to collapse and nothing to uninstall yet.
    expect(
      screen.queryByRole('button', { name: 'More options' })
    ).not.toBeInTheDocument()
  })

  it('gives non-owners neither Install nor the overflow menu', () => {
    mockAppHook.status = { installed: false }
    const { rerender } = render(
      <GitHubIntegrationCard workspaceUrl='acme' isOwner={false} />
    )
    expect(
      screen.queryByRole('button', { name: 'Install' })
    ).not.toBeInTheDocument()

    mockAppHook.status = { installed: true, accountLogin: 'acme-inc' }
    rerender(<GitHubIntegrationCard workspaceUrl='acme' isOwner={false} />)
    expect(
      screen.queryByRole('button', { name: 'More options' })
    ).not.toBeInTheDocument()
  })

  it('confirms before uninstalling', () => {
    mockAppHook.status = { installed: true, accountLogin: 'acme-inc' }
    mockAppHook.uninstallOpen = true
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)

    expect(screen.getByText('Uninstall the GitHub App?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }))
    expect(mockAppHook.handleUninstall).toHaveBeenCalled()
    mockAppHook.uninstallOpen = false
  })

  it('reports "connected" to the page as installed, never before the read resolves', () => {
    const onConnectedChange = jest.fn()
    mockAppHook.loading = true
    const { rerender } = render(
      <GitHubIntegrationCard
        workspaceUrl='acme'
        isOwner
        onConnectedChange={onConnectedChange}
      />
    )
    expect(
      screen.queryByRole('button', { name: 'Install' })
    ).not.toBeInTheDocument()

    mockAppHook.loading = false
    mockAppHook.status = { installed: true, accountLogin: 'acme-inc' }
    rerender(
      <GitHubIntegrationCard
        workspaceUrl='acme'
        isOwner
        onConnectedChange={onConnectedChange}
      />
    )
    expect(onConnectedChange).toHaveBeenLastCalledWith(true)
  })
})
