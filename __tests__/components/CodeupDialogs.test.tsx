/**
 * LUM-1315 — the Codeup connect / repositories dialogs and the card hook.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))
jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'acme' }),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/api-client/codeup', () => ({
  codeupApi: {
    getStatus: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    listRepositories: jest.fn(),
    updateRepositories: jest.fn(),
  },
}))

import type { ReactNode } from 'react'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  renderHook,
  act,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { codeupApi } from '@/lib/api-client/codeup'
import { CodeupConnectDialog } from '@/app/workspace/[workspaceUrl]/components/CodeupConnectDialog'
import { CodeupRepositoriesDialog } from '@/app/workspace/[workspaceUrl]/components/CodeupRepositoriesDialog'
import { useCodeupIntegration } from '@/app/workspace/[workspaceUrl]/hooks/useCodeupIntegration'

const api = codeupApi as jest.Mocked<typeof codeupApi>

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => jest.clearAllMocks())

describe('CodeupConnectDialog', () => {
  function fill() {
    const [org, token] = Array.from(
      document.body.querySelectorAll('input')
    ) as HTMLInputElement[]
    fireEvent.change(org!, { target: { value: 'org-1' } })
    fireEvent.change(token!, { target: { value: 'pt-secret' } })
  }

  it('connects with the organization id and token, then reports back', async () => {
    api.connect.mockResolvedValue({ success: true, repositories: [] })
    const onConnected = jest.fn()
    const onOpenChange = jest.fn()
    render(
      <CodeupConnectDialog
        open
        onOpenChange={onOpenChange}
        onConnected={onConnected}
      />
    )
    fill()
    fireEvent.click(screen.getByText('common.connect'))
    await waitFor(() => expect(onConnected).toHaveBeenCalled())
    expect(api.connect).toHaveBeenCalledWith('acme', {
      organizationId: 'org-1',
      accessToken: 'pt-secret',
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('LUM-1316: tells the owner reviews post as the token owner (use a service account)', () => {
    render(
      <CodeupConnectDialog
        open
        onOpenChange={jest.fn()}
        onConnected={jest.fn()}
      />
    )
    expect(screen.getByTestId('codeup-comment-author-hint').textContent).toBe(
      'codeup.commentAuthorHint'
    )
  })

  it('shows the localized error when Codeup refuses', async () => {
    api.connect.mockRejectedValue(new Error('refused'))
    const onConnected = jest.fn()
    render(
      <CodeupConnectDialog
        open
        onOpenChange={jest.fn()}
        onConnected={onConnected}
      />
    )
    fill()
    fireEvent.click(screen.getByText('common.connect'))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('codeup.connectFailed')
    )
    expect(onConnected).not.toHaveBeenCalled()
  })
})

describe('CodeupRepositoriesDialog', () => {
  it('starts from the confirmed set and saves the new selection', async () => {
    api.listRepositories.mockResolvedValue({
      repositories: [
        {
          repositoryId: 14,
          pathWithNamespace: 'o/a',
          webUrl: 'w',
          confirmed: true,
        },
        {
          repositoryId: 15,
          pathWithNamespace: 'o/b',
          webUrl: 'w',
          confirmed: false,
        },
      ],
    })
    api.updateRepositories.mockResolvedValue({ connected: false })
    const onSaved = jest.fn()
    render(
      <CodeupRepositoriesDialog
        open
        onOpenChange={jest.fn()}
        onSaved={onSaved}
      />,
      { wrapper }
    )
    await screen.findByText('o/b')
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes[0]).toHaveAttribute('data-state', 'checked')
    fireEvent.click(boxes[1]!)
    fireEvent.click(screen.getByText('common.save'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(api.updateRepositories).toHaveBeenCalledWith('acme', [14, 15])
  })

  it('says so when Codeup lists nothing', async () => {
    api.listRepositories.mockResolvedValue({ repositories: [] })
    render(
      <CodeupRepositoriesDialog
        open
        onOpenChange={jest.fn()}
        onSaved={jest.fn()}
      />,
      { wrapper }
    )
    expect(await screen.findByText('codeup.noRepositories')).toBeInTheDocument()
  })
})

describe('useCodeupIntegration — failure', () => {
  it('reports a failed disconnect with a toast instead of throwing', async () => {
    api.getStatus.mockResolvedValue({ connected: false })
    api.disconnect.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useCodeupIntegration(), { wrapper })
    await act(async () => {
      await expect(result.current.handleDisconnect()).resolves.toBeUndefined()
    })
    expect(toast.error).toHaveBeenCalledWith('codeup.disconnectFailed')
  })
})

describe('useCodeupIntegration', () => {
  it('loads the status and disconnects', async () => {
    api.getStatus.mockResolvedValue({
      connected: true,
      organizationId: 'org-1',
      repositories: [],
    })
    api.disconnect.mockResolvedValue({ success: true })
    const { result } = renderHook(() => useCodeupIntegration(), { wrapper })
    await waitFor(() => expect(result.current.status).not.toBeNull())
    expect(result.current.status).toMatchObject({ connected: true })
    await act(async () => {
      await result.current.handleDisconnect()
    })
    expect(api.disconnect).toHaveBeenCalledWith('acme')
    await waitFor(() =>
      expect(result.current.status).toEqual({ connected: false })
    )
  })
})
