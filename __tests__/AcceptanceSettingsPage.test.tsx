import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AcceptanceSettingsPage } from '@/app/workspace/[workspaceUrl]/components/pages/AcceptanceSettingsPage'
import { workspacesClient } from '@/lib/api-client'

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))

const mockReplace = jest.fn()
jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'acme' }),
  useRouter: () => ({ replace: mockReplace }),
}))

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))

jest.mock('@/lib/api-client', () => ({
  workspacesClient: { getMe: jest.fn(), updateMe: jest.fn() },
}))

jest.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

const getMe = workspacesClient.getMe as jest.Mock
const updateMe = workspacesClient.updateMe as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  getMe.mockResolvedValue({
    workspace: { verificationMaxRounds: 4, acceptanceMode: false },
    role: 'OWNER',
  })
  updateMe.mockResolvedValue({ workspace: {} })
})

describe('acceptance settings page (LUM-434)', () => {
  it('renders both moved controls for an OWNER (acceptance switch + round-cap input)', async () => {
    render(<AcceptanceSettingsPage />)

    const toggle = await screen.findByRole('switch')
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    const cap = screen.getByRole('spinbutton')
    expect(cap).toHaveValue(4)
  })

  it('persists the acceptance-mode toggle via updateMe(acceptanceMode)', async () => {
    render(<AcceptanceSettingsPage />)
    const toggle = await screen.findByRole('switch')

    fireEvent.click(toggle)

    await waitFor(() =>
      expect(updateMe).toHaveBeenCalledWith({ acceptanceMode: true })
    )
  })

  it('persists the verification round cap via updateMe(verificationMaxRounds)', async () => {
    render(<AcceptanceSettingsPage />)
    const cap = await screen.findByRole('spinbutton')

    fireEvent.change(cap, { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(updateMe).toHaveBeenCalledWith({ verificationMaxRounds: 6 })
    )
  })

  it('redirects a non-owner away from the page', async () => {
    getMe.mockResolvedValue({
      workspace: { verificationMaxRounds: 3, acceptanceMode: false },
      role: 'MEMBER',
    })
    render(<AcceptanceSettingsPage />)

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        '/workspace/acme/settings/members'
      )
    )
  })
})
