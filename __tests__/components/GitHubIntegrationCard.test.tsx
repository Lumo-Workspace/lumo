/** @jest-environment jsdom */

/**
 * GitHubIntegrationCard is a TEAM integration card.
 * - req ③: the connected personal account (@login) line is never rendered.
 * - req ②: non-owners get no Connect button and no overflow (⋯) menu.
 * react-intl and the network hook are mocked so the test exercises only the
 * card's owner-gating and connected-body markup.
 */
const messages: Record<string, string> = {
  'github.title': 'GitHub',
  'github.description': 'desc',
  'github.connected': 'Connected',
  'github.connectedAs': 'Connected as',
  'github.authorizedRepos': 'Authorized repositories',
  'github.noRepos': 'No repositories',
  'github.addRepo': 'Add repository',
  'github.addRepoDesc': 'Pick a repo',
  'github.removeRepo': 'Remove',
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
  addRepoOpen: false,
  setAddRepoOpen: jest.fn(),
  availableRepos: [] as { fullName: string; name: string; private: boolean }[],
  loadingRepos: false,
  handleConnect: jest.fn(),
  handleDisconnect: jest.fn(),
  handleRemoveRepo: jest.fn(),
  openAddRepo: jest.fn(),
  handleAddRepo: jest.fn(),
}

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useGitHubIntegration', () => ({
  useGitHubIntegration: () => mockHook,
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { GitHubIntegrationCard } from '@/app/workspace/[workspaceUrl]/components/GitHubIntegrationCard'

describe('GitHubIntegrationCard', () => {
  beforeEach(() => {
    mockHook.status = null
    mockHook.loading = false
  })

  it('never renders the connected personal account (@login) line', () => {
    mockHook.status = {
      connected: true,
      githubLogin: 'octocat',
      repositories: ['acme/web'],
    }
    render(<GitHubIntegrationCard workspaceUrl='acme' isOwner />)

    // Expand the collapsible connected body.
    // Two buttons carry aria-expanded=false (the ⋯ menu trigger and the
    // chevron toggle); the chevron is the one without aria-haspopup.
    const chevron = screen
      .getAllByRole('button', { expanded: false })
      .find(b => !b.hasAttribute('aria-haspopup'))
    fireEvent.click(chevron!)

    // Body is open (repos header is visible) ...
    expect(screen.getByText('Authorized repositories')).toBeInTheDocument()
    // ... but the personal account identity line is gone.
    expect(screen.queryByText('Connected as')).not.toBeInTheDocument()
    expect(screen.queryByText(/octocat/)).not.toBeInTheDocument()
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
})
