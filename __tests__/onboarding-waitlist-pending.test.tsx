/** @jest-environment jsdom */

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: { alt: string }) => <img alt={props.alt} />,
}))

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OnboardingClient } from '@/app/onboarding/OnboardingClient'

describe('onboarding waitlist pending (LUM-1344)', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('shows the waitlist-pending message instead of the error line on a WORKSPACE_APPROVAL_REQUIRED response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: 'Approval required',
        code: 'WORKSPACE_APPROVAL_REQUIRED',
      }),
    }) as unknown as typeof fetch

    render(<OnboardingClient />)
    fireEvent.change(document.querySelector('#ws-name')!, {
      target: { value: 'Acme' },
    })
    fireEvent.click(screen.getByText('onboarding.workspace.continue'))

    await waitFor(() =>
      expect(screen.getByText('onboarding.waitlistPending.title')).toBeTruthy()
    )
    expect(screen.getByText('onboarding.waitlistPending.body')).toBeTruthy()
    expect(screen.queryByText('Approval required')).toBeNull()
    expect(screen.queryByText('onboarding.workspace.continue')).toBeNull()
    expect(document.querySelector('#ws-name')).toBeNull()
  })

  it('keeps the plain error line for other failures', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Slug taken' }),
    }) as unknown as typeof fetch

    render(<OnboardingClient />)
    fireEvent.change(document.querySelector('#ws-name')!, {
      target: { value: 'Acme' },
    })
    fireEvent.click(screen.getByText('onboarding.workspace.continue'))
    await waitFor(() => expect(screen.getByText('Slug taken')).toBeTruthy())
    expect(screen.queryByText('onboarding.waitlistPending.title')).toBeNull()
  })
})
