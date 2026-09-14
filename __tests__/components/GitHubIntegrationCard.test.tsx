/** @jest-environment jsdom */

/**
 * GitHubIntegrationCard is the TEAM GitHub card and shows the App
 * installation only. A member's own GitHub login is a PERSONAL card
 * (GitHubAccountCard) and must never appear here.
 * - non-owners get no Install / Uninstall control;
 * - an un-installed App says security scanning is not enabled;
 * - "connected" reported to the page means "installed".
 */
const messages: Record<string, string> = {
  'github.title': 'GitHub',
  'github.description': 'desc',
  'github.appRow': 'GitHub App installed',
  'github.appRowDesc': 'Lets Lumo scan this workspace with its own token',
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
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id, ...rest }: { id: string }) => {
      const values = (rest as { values?: Record<string, string> }).values
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

import { render, screen, fireEvent, within } from '@testing-library/react'
import { GitHubIntegrationCard } from '@/app/workspace/[workspaceUrl]/components/GitHubIntegrationCard'

describe('GitHubIntegrationCard (team: App installation only)', () => {
  beforeEach(() => {
    mockAppHook.status = null
    mockAppHook.loading = false
    jest.clearAllMocks()
  })

  it('carries no personal OAuth row, menu or Connect control', () => {
    mockAppHook.status = { installed: true, accountLogin: 'acme-inc' }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)

    expect(screen.queryByTestId('github-oauth-row')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Connect|More options/ })
    ).not.toBeInTheDocument()
  })

  it('says security scanning is not enabled while the App is not installed', () => {
    mockAppHook.status = { installed: false }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)

    expect(
      screen.getByText('Security scanning is not enabled')
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('github-app-row')).getByRole('button', {
        name: 'Install',
      })
    ).toBeInTheDocument()
  })

  it('drops the warning and offers Uninstall once installed', () => {
    mockAppHook.status = { installed: true, accountLogin: 'acme-inc' }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)

    expect(
      screen.queryByText('Security scanning is not enabled')
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Uninstall' })
    ).toBeInTheDocument()
  })

  it('starts the installation from the App row', () => {
    mockAppHook.status = { installed: false }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(mockAppHook.handleInstall).toHaveBeenCalled()
  })

  it('gives non-owners neither Install nor Uninstall', () => {
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

  it('lists the installation repositories read-only, managed on GitHub', () => {
    mockAppHook.status = {
      installed: true,
      accountLogin: 'acme-inc',
      repositories: ['acme-inc/web', 'acme-inc/api'],
    }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)

    expect(screen.getByText('acme-inc/web')).toBeInTheDocument()
    expect(screen.getByText('acme-inc/api')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Manage on GitHub/ })
    ).toHaveAttribute('href', 'https://github.com/settings/installations')
  })

  it('reports "connected" to the page as installed, and never before the read resolves', () => {
    const onConnectedChange = jest.fn()
    mockAppHook.loading = true
    const { rerender } = render(
      <GitHubIntegrationCard
        workspaceUrl='acme'
        isOwner
        onConnectedChange={onConnectedChange}
      />
    )
    // `undefined` is "not known yet" (LUM-684): reported as not connected,
    // but nothing on screen treats it as "not set up".
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
