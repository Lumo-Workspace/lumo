/**
 * LUM-1341 — the two Feishu cards render their hook's state: the owner
 * installs the workspace app; a member connects their own account, and a
 * link whose refresh failed (needsReauth) asks them to reconnect.
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
jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'acme' }),
}))
const teamHook: Record<string, unknown> = {}
const accountHook: Record<string, unknown> = {}
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useFeishuIntegration', () => ({
  useFeishuIntegration: () => teamHook,
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useFeishuAccount', () => ({
  useFeishuAccount: () => accountHook,
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { FeishuIntegrationCard } from '@/app/workspace/[workspaceUrl]/components/FeishuIntegrationCard'
import { FeishuAccountCard } from '@/app/workspace/[workspaceUrl]/components/FeishuAccountCard'

function set(
  target: Record<string, unknown>,
  over: Record<string, unknown>
): void {
  for (const k of Object.keys(target)) delete target[k]
  Object.assign(target, {
    loading: false,
    disconnectOpen: false,
    setDisconnectOpen: jest.fn(),
    disconnecting: false,
    handleConnect: jest.fn(),
    handleDisconnect: jest.fn(),
    ...over,
  })
}

// Connected cards start collapsed; open the details.
function expand(): void {
  const toggles = document.body.querySelectorAll('button[aria-expanded]')
  fireEvent.click(toggles[toggles.length - 1]!)
}

describe('FeishuIntegrationCard (TEAM)', () => {
  it('offers Connect to an owner and reports not connected', () => {
    set(teamHook, { status: { connected: false } })
    const onConnectedChange = jest.fn()
    render(
      <FeishuIntegrationCard isOwner onConnectedChange={onConnectedChange} />
    )
    fireEvent.click(screen.getByText('common.connect'))
    expect(teamHook.handleConnect).toHaveBeenCalled()
    expect(onConnectedChange).toHaveBeenCalledWith(false)
  })

  it('shows no Connect button to a member', () => {
    set(teamHook, { status: { connected: false } })
    render(<FeishuIntegrationCard isOwner={false} />)
    expect(screen.queryByText('common.connect')).toBeNull()
  })

  it('names the connected tenant', () => {
    set(teamHook, {
      status: {
        connected: true,
        tenantName: 'Lumo Inc',
        domain: 'feishu',
        reinstallRequired: false,
      },
    })
    const onConnectedChange = jest.fn()
    render(
      <FeishuIntegrationCard isOwner onConnectedChange={onConnectedChange} />
    )
    expand()
    expect(screen.getByText('Lumo Inc')).toBeInTheDocument()
    expect(onConnectedChange).toHaveBeenCalledWith(true)
  })

  it('a stale install stays open and says an owner must reconnect', () => {
    set(teamHook, {
      status: {
        connected: true,
        tenantName: 'Lumo Inc',
        domain: 'feishu',
        reinstallRequired: true,
      },
    })
    render(<FeishuIntegrationCard isOwner />)
    expect(screen.getByTestId('feishu-reinstall-required')).toHaveTextContent(
      'feishu.error.reinstallRequired'
    )
  })

  it('does not report before the status has loaded', () => {
    set(teamHook, { status: null, loading: true })
    const onConnectedChange = jest.fn()
    render(
      <FeishuIntegrationCard isOwner onConnectedChange={onConnectedChange} />
    )
    expect(onConnectedChange).not.toHaveBeenCalled()
  })
})

describe('FeishuAccountCard (PERSONAL)', () => {
  it('links to the account connect route once the workspace has the app', () => {
    set(accountHook, {
      status: {
        installed: true,
        connected: false,
        name: null,
        needsReauth: false,
      },
    })
    render(<FeishuAccountCard />)
    expect(screen.getByText('common.connect').closest('a')).toHaveAttribute(
      'href',
      '/api/feishu/account/connect?workspaceUrl=acme'
    )
  })

  it('says an owner must install first, with no Connect button', () => {
    set(accountHook, {
      status: {
        installed: false,
        connected: false,
        name: null,
        needsReauth: false,
      },
    })
    render(<FeishuAccountCard />)
    expect(screen.getByText('feishuAccount.notInstalled')).toBeInTheDocument()
    expect(screen.queryByText('common.connect')).toBeNull()
  })

  it('shows who is connected', () => {
    set(accountHook, {
      status: {
        installed: true,
        connected: true,
        name: 'Chao',
        needsReauth: false,
      },
    })
    render(<FeishuAccountCard />)
    expand()
    expect(screen.getByText('Chao')).toBeInTheDocument()
    expect(screen.queryByTestId('feishu-account-reauth')).toBeNull()
  })

  it('asks the member to reconnect when the link needs reauth', () => {
    set(accountHook, {
      status: {
        installed: true,
        connected: true,
        name: 'Chao',
        needsReauth: true,
      },
    })
    render(<FeishuAccountCard />)
    // Not collapsed: the prompt shows without opening the card.
    expect(screen.getByTestId('feishu-account-reauth')).toHaveTextContent(
      'feishuAccount.reauthRequired'
    )
    expect(
      screen.getByText('feishuAccount.reconnect').closest('a')
    ).toHaveAttribute('href', '/api/feishu/account/connect?workspaceUrl=acme')
  })
})
