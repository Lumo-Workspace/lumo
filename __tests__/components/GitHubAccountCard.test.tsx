/** @jest-environment jsdom */

/**
 * GitHubAccountCard is the PERSONAL GitHub card: a member's own OAuth link,
 * identity only. Connect / Reauthorize / Disconnect belong to the member, so
 * there is no owner gating — every member sees their own.
 */
const messages: Record<string, string> = {
  'githubAccount.title': 'GitHub account',
  'githubAccount.description': 'desc',
  'githubAccount.connected': 'Authorized',
  'githubAccount.connectedAs': 'Linked as',
  'github.disconnectTitle': 'Disconnect GitHub?',
  'github.disconnectDesc': 'Your access token will be deleted.',
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
jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'acme' }),
}))

const mockHook = {
  status: null as null | { connected: boolean; githubLogin?: string },
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

import { render, screen, fireEvent } from '@testing-library/react'
import { GitHubAccountCard } from '@/app/workspace/[workspaceUrl]/components/GitHubAccountCard'

describe('GitHubAccountCard (personal: OAuth identity link)', () => {
  beforeEach(() => {
    mockHook.status = null
    mockHook.loading = false
    mockHook.disconnectOpen = false
    jest.clearAllMocks()
  })

  it('offers Connect to any member when not linked', () => {
    mockHook.status = { connected: false }
    render(<GitHubAccountCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(mockHook.handleConnect).toHaveBeenCalled()
  })

  it('shows the linked login and the overflow menu once linked', () => {
    mockHook.status = { connected: true, githubLogin: 'octocat' }
    render(<GitHubAccountCard />)

    expect(
      screen.queryByRole('button', { name: 'Connect' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'More options' })
    ).toBeInTheDocument()
    // Expand the collapsible body to read the identity line.
    const chevron = screen
      .getAllByRole('button', { expanded: false })
      .find(b => !b.hasAttribute('aria-haspopup'))
    fireEvent.click(chevron!)
    expect(screen.getByText('@octocat')).toBeInTheDocument()
  })

  it('reports its link state to the page', () => {
    const onConnectedChange = jest.fn()
    mockHook.status = { connected: true, githubLogin: 'octocat' }
    render(<GitHubAccountCard onConnectedChange={onConnectedChange} />)
    expect(onConnectedChange).toHaveBeenLastCalledWith(true)
  })

  it('confirms before disconnecting', () => {
    mockHook.status = { connected: true, githubLogin: 'octocat' }
    mockHook.disconnectOpen = true
    render(<GitHubAccountCard />)

    expect(screen.getByText('Disconnect GitHub?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(mockHook.handleDisconnect).toHaveBeenCalled()
  })
})
