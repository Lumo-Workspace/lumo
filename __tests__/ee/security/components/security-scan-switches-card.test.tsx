/** @jest-environment jsdom */
/**
 * LUM-866 — the settings card for the PR security-scan switches.
 * LUM-1002 — saves go to /api/workspaces/me/security-scan; disable all /
 * enable all saves every switch at once.
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
jest.mock('@/ee/security/api-client', () => ({
  securityScanClient: { updateSecurityScan: jest.fn() },
}))

import { SecurityScanSwitchesCard } from '@/ee/security/components/settings/SecurityScanSwitchesCard'
import { securityScanClient } from '@/ee/security/api-client'

const updateSecurityScan = securityScanClient.updateSecurityScan as jest.Mock

const ALL_ON = {
  securityScanEnabled: true,
  securityAiReviewEnabled: true,
  securityHuntEnabled: true,
}

function renderCard(
  initial = ALL_ON,
  huntAvailable = true,
  sandboxAvailable = true
) {
  return render(
    <SecurityScanSwitchesCard
      initial={initial}
      huntAvailable={huntAvailable}
      sandboxAvailable={sandboxAvailable}
    />
  )
}

const toggle = (name: string) => screen.getByRole('switch', { name })

beforeEach(() => {
  jest.clearAllMocks()
  updateSecurityScan.mockImplementation(async (u: Record<string, boolean>) => ({
    switches:
      'all' in u
        ? {
            securityScanEnabled: u.all,
            securityAiReviewEnabled: u.all,
            securityHuntEnabled: u.all,
          }
        : { ...ALL_ON, ...u },
  }))
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
    renderCard(ALL_ON, false)
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
      expect(updateSecurityScan).toHaveBeenCalledWith({
        securityScanEnabled: true,
        securityAiReviewEnabled: true,
        securityHuntEnabled: false,
      })
    )
  })

  it('LUM-1002 disable all saves { all: false } and then offers enable all', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Disable all' }))
    await waitFor(() =>
      expect(updateSecurityScan).toHaveBeenCalledWith({ all: false })
    )
    expect(
      await screen.findByRole('button', { name: 'Enable all' })
    ).toBeInTheDocument()
    expect(toggle('Security scan')).toHaveAttribute('aria-checked', 'false')
    expect(toggle('AI review')).toHaveAttribute('aria-checked', 'false')
    expect(toggle('Exploit-path hunt')).toHaveAttribute('aria-checked', 'false')
  })

  it('LUM-1002 enable all saves { all: true } when every switch is off', async () => {
    renderCard({
      securityScanEnabled: false,
      securityAiReviewEnabled: false,
      securityHuntEnabled: false,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enable all' }))
    await waitFor(() =>
      expect(updateSecurityScan).toHaveBeenCalledWith({ all: true })
    )
    expect(
      await screen.findByRole('button', { name: 'Disable all' })
    ).toBeInTheDocument()
  })
})

describe('LUM-1025 SecurityScanSwitchesCard without Vercel Sandbox', () => {
  it('locks the hunt and says the deployment lacks Sandbox, not that Lumo turned it off', () => {
    renderCard(ALL_ON, false, false)
    expect(toggle('Exploit-path hunt')).toBeDisabled()
    expect(
      screen.getByText(
        'Not available on this deployment: Vercel Sandbox is not configured.'
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Currently turned off for all workspaces by Lumo.')
    ).toBeNull()
    expect(
      screen.getByText(
        /Lumo's own scanners and the review verifier need Vercel Sandbox/
      )
    ).toBeInTheDocument()
  })

  it('keeps the platform-off note when Sandbox is configured', () => {
    renderCard(ALL_ON, false, true)
    expect(
      screen.getByText('Currently turned off for all workspaces by Lumo.')
    ).toBeInTheDocument()
    expect(screen.queryByText(/need Vercel Sandbox/)).toBeNull()
  })
})
