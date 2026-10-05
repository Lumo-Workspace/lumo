/** @jest-environment jsdom */
/**
 * LUM-906 PR1 — the invite page when the signed-in account is not the
 * invited one: a localized message naming the masked invited address and a
 * button that signs out and comes back to the invite through sign-in.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => (values ? `${id} ${JSON.stringify(values)}` : id),
  }),
  FormattedMessage: ({ id }: { id: string }) => id,
}))

const mockSignOut = jest.fn()
const mockPush = jest.fn()
jest.mock('@clerk/nextjs', () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: true }),
  useClerk: () => ({ signOut: mockSignOut }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const mockAccept = jest.fn()
jest.mock('@/lib/api-client', () => ({
  invitesClient: { accept: (...a: unknown[]) => mockAccept(...a) },
  ApiClientError: jest.requireActual('@/lib/api-client/base').ApiClientError,
}))

import { fireEvent, render, screen } from '@testing-library/react'
import { AcceptInviteClient } from '@/app/invite/[token]/AcceptInviteClient'
import { ApiClientError } from '@/lib/api-client/base'

function renderPage() {
  return render(
    <AcceptInviteClient
      token='tok-1'
      workspaceName='Acme'
      workspaceSlug='acme'
      inviterName='Bob'
      maskedEmail='a***@acme.com'
      status='PENDING'
    />
  )
}

beforeEach(() => jest.clearAllMocks())

describe('LUM-906 invite page email mismatch', () => {
  it('invite page shows the masked invited address and a switch-account action on mismatch', async () => {
    mockAccept.mockRejectedValue(
      new ApiClientError('different email', 403, 'INVITE_EMAIL_MISMATCH')
    )
    renderPage()

    expect(await screen.findByText('invite.mismatch.title')).toBeTruthy()
    const body = screen.getByText(/invite\.mismatch\.body/)
    expect(body.textContent).toContain('a***@acme.com')
    expect(mockPush).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('invite.mismatch.switchAccount'))
    expect(mockSignOut).toHaveBeenCalledWith({
      redirectUrl: `/signin?redirect_url=${encodeURIComponent('/invite/tok-1')}`,
    })
  })

  it('invite page keeps the generic error for other failures', async () => {
    mockAccept.mockRejectedValue(
      new ApiClientError('expired', 410, 'API_ERROR')
    )
    renderPage()

    expect(await screen.findByText('invite.error.title')).toBeTruthy()
    expect(screen.queryByText('invite.mismatch.title')).toBeNull()
  })

  it('invite page routes into the workspace when accept succeeds', async () => {
    mockAccept.mockResolvedValue({ workspaceSlug: 'acme' })
    renderPage()

    await screen.findByText(/invite\.joining/)
    await new Promise(r => setTimeout(r, 0))
    expect(mockPush).toHaveBeenCalledWith('/workspace/acme')
  })
})
