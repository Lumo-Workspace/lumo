/**
 * LUM-1315 — the Codeup settings card renders the hook's state: a connect
 * button for owners, then the organization and its confirmed repositories.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => (values ? [id, ...Object.values(values)] : id),
  }),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/CodeupConnectDialog',
  () => ({
    CodeupConnectDialog: () => null,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/CodeupRepositoriesDialog',
  () => ({ CodeupRepositoriesDialog: () => null })
)
const hookState: Record<string, unknown> = {}
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useCodeupIntegration', () => ({
  useCodeupIntegration: () => hookState,
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { CodeupIntegrationCard } from '@/app/workspace/[workspaceUrl]/components/CodeupIntegrationCard'

function setHook(over: Record<string, unknown>) {
  for (const k of Object.keys(hookState)) delete hookState[k]
  Object.assign(hookState, {
    status: { connected: false },
    loading: false,
    connectOpen: false,
    setConnectOpen: jest.fn(),
    repositoriesOpen: false,
    setRepositoriesOpen: jest.fn(),
    disconnectOpen: false,
    setDisconnectOpen: jest.fn(),
    disconnecting: false,
    handleDisconnect: jest.fn(),
    refreshStatus: jest.fn(),
    ...over,
  })
}

describe('CodeupIntegrationCard', () => {
  it('offers Connect to an owner when not connected', () => {
    setHook({})
    const onConnectedChange = jest.fn()
    render(
      <CodeupIntegrationCard isOwner onConnectedChange={onConnectedChange} />
    )
    fireEvent.click(screen.getByText('common.connect'))
    expect(hookState.setConnectOpen).toHaveBeenCalledWith(true)
    expect(onConnectedChange).toHaveBeenCalledWith(false)
  })

  it('shows no Connect button to a member', () => {
    setHook({})
    render(<CodeupIntegrationCard isOwner={false} />)
    expect(screen.queryByText('common.connect')).toBeNull()
  })

  it('lists the confirmed repositories once connected', () => {
    setHook({
      status: {
        connected: true,
        organizationId: 'org-1',
        repositories: [
          { repositoryId: 14, pathWithNamespace: 'org-1/g/app', webUrl: 'w' },
        ],
      },
    })
    const onConnectedChange = jest.fn()
    render(
      <CodeupIntegrationCard isOwner onConnectedChange={onConnectedChange} />
    )
    expect(onConnectedChange).toHaveBeenCalledWith(true)
    // Connected cards start collapsed; open the details.
    const toggles = document.body.querySelectorAll('button[aria-expanded]')
    fireEvent.click(toggles[toggles.length - 1]!)
    expect(screen.getByTestId('codeup-repositories').textContent).toContain(
      'org-1/g/app'
    )
    // LUM-1316: reviews post as the token owner — say so, once connected.
    expect(screen.getByTestId('codeup-comment-author-hint').textContent).toBe(
      'codeup.commentAuthorHint'
    )
    fireEvent.click(screen.getByText('codeup.chooseRepositories'))
    expect(hookState.setRepositoriesOpen).toHaveBeenCalledWith(true)
  })
})
