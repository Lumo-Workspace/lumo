/** @jest-environment jsdom */
/**
 * LUM-866 — the settings card for the PR security-scan switches.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// react-intl's ESM build is not loadable through jest here (repo convention:
// mock it) — resolve ids against the real en copy so labels are assertable.
jest.mock('react-intl', () => {
  const en = jest.requireActual('@/lib/i18n/en.json') as Record<string, string>
  return {
    useIntl: () => ({
      formatMessage: ({ id }: { id: string }) => en[id] ?? id,
    }),
  }
})
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/api-client', () => ({
  workspacesClient: { updateMe: jest.fn() },
}))

import { SecurityScanSwitchesCard } from '@/app/workspace/[workspaceUrl]/components/settings/SecurityScanSwitchesCard'
import { workspacesClient } from '@/lib/api-client'

const updateMe = workspacesClient.updateMe as jest.Mock

const ALL_ON = {
  securityScanEnabled: true,
  securityAiReviewEnabled: true,
  securityHuntEnabled: true,
}

function renderCard(
  initial = ALL_ON,
  platform = { managedScan: true, hunt: true }
) {
  return render(
    <SecurityScanSwitchesCard initial={initial} platform={platform} />
  )
}

const toggle = (name: string) => screen.getByRole('switch', { name })

beforeEach(() => {
  jest.clearAllMocks()
  updateMe.mockResolvedValue({})
})

describe('LUM-866 SecurityScanSwitchesCard', () => {
  it('renders the three switches from the stored values', () => {
    renderCard({ ...ALL_ON, securityAiReviewEnabled: false })
    expect(toggle('Security scan')).toHaveAttribute('aria-checked', 'true')
    expect(toggle('AI review')).toHaveAttribute('aria-checked', 'false')
    expect(toggle('Exploit-path hunt')).toHaveAttribute('aria-checked', 'true')
  })

  it('turning the scan off shows AI review and hunt off and locked', () => {
    renderCard()
    fireEvent.click(toggle('Security scan'))
    expect(toggle('AI review')).toBeDisabled()
    expect(toggle('AI review')).toHaveAttribute('aria-checked', 'false')
    expect(toggle('Exploit-path hunt')).toBeDisabled()
    expect(toggle('Exploit-path hunt')).toHaveAttribute('aria-checked', 'false')
  })

  it('a hunt the platform turned off is off, locked and explained', () => {
    renderCard(ALL_ON, { managedScan: true, hunt: false })
    expect(toggle('Exploit-path hunt')).toBeDisabled()
    expect(toggle('Exploit-path hunt')).toHaveAttribute('aria-checked', 'false')
    expect(
      screen.getByText('Currently turned off for all workspaces by Lumo.')
    ).toBeInTheDocument()
  })

  it('save sends every switch to the workspace settings API', async () => {
    renderCard()
    fireEvent.click(toggle('Exploit-path hunt'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateMe).toHaveBeenCalledWith({
        securityScanEnabled: true,
        securityAiReviewEnabled: true,
        securityHuntEnabled: false,
      })
    )
  })
})
