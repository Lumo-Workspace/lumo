/** @jest-environment jsdom */

/**
 * GitHubIntegrationCard is a TEAM integration card.
 * - req ③: the connected personal account (@login) line is never rendered.
 * - req ②: non-owners get no Connect button and no overflow (⋯) menu.
 * - LUM-741: OAuth authorization and App installation are two independent
 *   chains with their own status dot and button. OAuth alone does NOT enable
 *   the managed security scan, and the card has to say so — a single green
 *   "connected" dot over an un-installed App is the lie this card used to tell.
 * react-intl and the network hooks are mocked so the test exercises only the
 * card's owner-gating and status markup.
 */
const messages: Record<string, string> = {
  'github.title': 'GitHub',
  'github.description': 'desc',
  'github.connected': 'Connected',
  'github.oauthRow': 'Authorized (OAuth)',
  'github.oauthRowDesc': 'Repository list, PR links and comment mirroring',
  'github.oauthConnected': 'Authorized',
  'github.appRow': 'GitHub App installed',
  'github.appRowDesc': 'Lets Lumo scan this workspace with its own token',
  'github.appInstalled': 'Installed',
  'github.appAccount': 'Installed on {account}',
  'github.installApp': 'Install',
  'github.uninstallApp': 'Uninstall',
  'github.scanDisabled': 'Security scanning is not enabled',
  'github.uninstallTitle': 'Uninstall the GitHub App?',
  'github.uninstallDesc': 'Lumo will no longer scan this workspace.',
  'github.connectedAs': 'Connected as',
  'github.appRepos': 'Repositories the App can reach',
  'github.appNoRepos': 'No repositories selected',
  'github.manageOnGithub': 'Manage on GitHub',
  'github.disconnectTitle': 'Disconnect GitHub',
  'github.disconnectDesc': 'Are you sure?',
  'common.connect': 'Connect',
  'common.reauthorize': 'Reauthorize',
  'common.disconnect': 'Disconnect',
  'common.cancel': 'Cancel',
  'common.moreOptions': 'More options',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
  }),
}))

// Mutable hook return; tests set `.status` before rendering.
const mockHook = {
  status: null as null | {
    connected: boolean
    githubLogin?: string
    repositories?: string[]
  },
  loading: false,
  disconnectOpen: false,
  setDisconnectOpen: jest.fn(),
  disconnecting: false,
  handleConnect: jest.fn(),
  handleDisconnect: jest.fn(),
}

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useGitHubIntegration', () => ({
  useGitHubIntegration: () => mockHook,
}))

// The App-installation chain: a second, independent status read.
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

import { render, screen, fireEvent, within } from '@testing-library/react'
import { GitHubIntegrationCard } from '@/app/workspace/[workspaceUrl]/components/GitHubIntegrationCard'

describe('GitHubIntegrationCard', () => {
  beforeEach(() => {
    mockHook.status = null
    mockHook.loading = false
    mockAppHook.status = null
    mockAppHook.loading = false
  })

  it('never renders the connected personal account (@login) line', () => {
    mockHook.status = {
      connected: true,
      githubLogin: 'octocat',
      repositories: ['acme/web'],
    }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)

    // The OAuth row reads as linked ...
    expect(screen.getByTestId('github-oauth-row').textContent).toContain(
      'Authorized'
    )
    // ... but the personal account identity line is gone.
    expect(screen.queryByText('Connected as')).not.toBeInTheDocument()
    expect(screen.queryByText(/octocat/)).not.toBeInTheDocument()
  })

  it('lists the installation repositories read-only, managed on GitHub', () => {
    mockHook.status = { connected: false }
    mockAppHook.status = {
      installed: true,
      accountLogin: 'acme-inc',
      repositories: ['acme-inc/web', 'acme-inc/api'],
    }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)

    expect(screen.getByText('acme-inc/web')).toBeInTheDocument()
    expect(screen.getByText('acme-inc/api')).toBeInTheDocument()
    // The set is chosen in GitHub's install settings — no add/remove here.
    expect(
      screen.getByRole('link', { name: /Manage on GitHub/ })
    ).toHaveAttribute('href', 'https://github.com/settings/installations')
    expect(
      screen.queryByRole('button', { name: /Add repository|Remove/ })
    ).not.toBeInTheDocument()
  })

  it('does not show the repository list before the App is installed', () => {
    mockHook.status = { connected: true, repositories: ['acme/web'] }
    mockAppHook.status = { installed: false }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)

    expect(
      screen.queryByText('Repositories the App can reach')
    ).not.toBeInTheDocument()
  })

  it('shows no Connect button to non-owners when disconnected', () => {
    mockHook.status = { connected: false }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner={false} />)
    expect(
      screen.queryByRole('button', { name: 'Connect' })
    ).not.toBeInTheDocument()
  })

  it('shows a Connect button to owners when disconnected', () => {
    mockHook.status = { connected: false }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })

  it('shows no overflow (⋯) menu to non-owners when connected', () => {
    mockHook.status = {
      connected: true,
      githubLogin: 'octocat',
      repositories: [],
    }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner={false} />)
    expect(
      screen.queryByRole('button', { name: 'More options' })
    ).not.toBeInTheDocument()
  })

  it('shows the overflow (⋯) menu to owners when connected', () => {
    mockHook.status = {
      connected: true,
      githubLogin: 'octocat',
      repositories: [],
    }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)
    expect(
      screen.getByRole('button', { name: 'More options' })
    ).toBeInTheDocument()
  })
  describe('OAuth vs App installation (LUM-741)', () => {
    it('says security scanning is not enabled when OAuth is connected but the App is not installed', () => {
      mockHook.status = { connected: true, repositories: ['acme/web'] }
      mockAppHook.status = { installed: false }

      render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)

      expect(
        screen.getByText('Security scanning is not enabled')
      ).toBeInTheDocument()
    })

    it('drops the warning once the App is installed', () => {
      mockHook.status = { connected: true, repositories: [] }
      mockAppHook.status = { installed: true, accountLogin: 'acme-inc' }

      render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)

      expect(
        screen.queryByText('Security scanning is not enabled')
      ).not.toBeInTheDocument()
    })

    it('renders both chains as their own row with an independent status', () => {
      mockHook.status = { connected: true, repositories: [] }
      mockAppHook.status = { installed: false }

      render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)

      const oauthRow = screen.getByTestId('github-oauth-row')
      const appRow = screen.getByTestId('github-app-row')

      // OAuth is authorized: a status dot, no Connect button in that row.
      expect(oauthRow.textContent).toContain('Authorized')
      // The App is not: its row offers the install action instead of a dot.
      expect(
        within(appRow).getByRole('button', { name: 'Install' })
      ).toBeInTheDocument()
      expect(appRow.textContent).not.toContain('Installed on')
    })

    it('offers Install and Connect independently when neither chain is set up', () => {
      mockHook.status = { connected: false }
      mockAppHook.status = { installed: false }

      render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)

      expect(
        within(screen.getByTestId('github-oauth-row')).getByRole('button', {
          name: 'Connect',
        })
      ).toBeInTheDocument()
      expect(
        within(screen.getByTestId('github-app-row')).getByRole('button', {
          name: 'Install',
        })
      ).toBeInTheDocument()
    })

    it('starts the installation from the App row', () => {
      mockHook.status = { connected: false }
      mockAppHook.status = { installed: false }

      render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)
      fireEvent.click(screen.getByRole('button', { name: 'Install' }))

      expect(mockAppHook.handleInstall).toHaveBeenCalled()
    })

    it('lets an owner uninstall the App without touching the OAuth connection', () => {
      mockHook.status = { connected: true, repositories: [] }
      mockAppHook.status = { installed: true, accountLogin: 'acme-inc' }

      render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)
      const appRow = screen.getByTestId('github-app-row')

      expect(
        within(appRow).getByRole('button', { name: 'Uninstall' })
      ).toBeInTheDocument()
      expect(mockHook.handleDisconnect).not.toHaveBeenCalled()
    })

    it('gives non-owners neither the Install nor the Uninstall control', () => {
      mockHook.status = { connected: true, repositories: [] }
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
        screen.queryByRole('button', { name: 'Uninstall' })
      ).not.toBeInTheDocument()
    })

    it('shows neither status as failed while the reads are still in flight', () => {
      mockHook.loading = true
      mockAppHook.loading = true

      render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)

      // `undefined` is "not known yet", never "not connected" (LUM-684).
      expect(
        screen.queryByText('Security scanning is not enabled')
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Install' })
      ).not.toBeInTheDocument()
    })
  })
})
