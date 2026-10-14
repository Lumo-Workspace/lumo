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
// LUM-1114: a save invalidates the policy-coverage query.
const invalidateQueries = jest.fn()
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries }),
}))
jest.mock('@/ee/security/api-client', () => ({
  securityScanClient: { updateSecurityScan: jest.fn() },
}))

import { SecurityScanSwitchesCard } from '@/ee/security/components/settings/SecurityScanSwitchesCard'
import { securityScanClient } from '@/ee/security/api-client'
import type { WorkspaceSecuritySwitches } from '@/ee/security/security-scan/workspace-switches'

const updateSecurityScan = securityScanClient.updateSecurityScan as jest.Mock

const ALL_ON = {
  securityScanEnabled: true,
  securityAiReviewEnabled: true,
  securityHuntEnabled: true,
  securityRequestChangesEnabled: false,
  securityLearningsScope: 'auto' as const,
  securityReviewAutoPauseAfter: 5,
}

function renderCard(
  initial: WorkspaceSecuritySwitches = ALL_ON,
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
            securityRequestChangesEnabled: false,
            securityLearningsScope: 'auto' as const,
            securityReviewAutoPauseAfter: 5,
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
        securityRequestChangesEnabled: false,
        securityLearningsScope: 'auto',
        securityReviewAutoPauseAfter: 5,
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
      securityRequestChangesEnabled: false,
      securityLearningsScope: 'auto',
      securityReviewAutoPauseAfter: 5,
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

describe('LUM-1130 request-changes workflow switch', () => {
  const rc = () => toggle('Request changes until resolved')

  it('is off by default and saved with the other switches', async () => {
    renderCard()
    expect(rc()).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(rc())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateSecurityScan).toHaveBeenCalledWith(
        expect.objectContaining({ securityRequestChangesEnabled: true })
      )
    )
  })

  it('reads off and locked with the scan off', () => {
    renderCard({ ...ALL_ON, securityRequestChangesEnabled: true })
    expect(rc()).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle('Security scan'))
    expect(rc()).toBeDisabled()
    expect(rc()).toHaveAttribute('aria-checked', 'false')
  })

  it('disable all leaves it as it is (it is not a layer)', async () => {
    renderCard({ ...ALL_ON, securityRequestChangesEnabled: true })
    fireEvent.click(screen.getByRole('button', { name: 'Disable all' }))
    await waitFor(() =>
      expect(updateSecurityScan).toHaveBeenCalledWith({ all: false })
    )
  })
})

describe('LUM-1134 learnings scope', () => {
  const scope = () =>
    screen.getByRole('combobox', {
      name: 'Learnings scope',
    }) as HTMLSelectElement

  it('shows the stored scope with all three choices, auto by default', () => {
    renderCard()
    expect(scope().value).toBe('auto')
    expect([...scope().options].map(o => o.value)).toEqual([
      'auto',
      'local',
      'global',
    ])
  })

  it('is saved with the other switches', async () => {
    renderCard()
    fireEvent.change(scope(), { target: { value: 'global' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateSecurityScan).toHaveBeenCalledWith(
        expect.objectContaining({ securityLearningsScope: 'global' })
      )
    )
  })

  it('reads the stored value and stays editable with the scan on only', () => {
    renderCard({ ...ALL_ON, securityLearningsScope: 'local' })
    expect(scope().value).toBe('local')
    expect(scope()).not.toBeDisabled()
    fireEvent.click(toggle('Security scan'))
    expect(scope()).toBeDisabled()
  })
})

it('LUM-1134 choosing global warns that public repositories may draw on private ones', () => {
  renderCard()
  expect(screen.queryByTestId('learnings-scope-global-warning')).toBeNull()
  fireEvent.change(screen.getByRole('combobox', { name: 'Learnings scope' }), {
    target: { value: 'global' },
  })
  expect(
    screen.getByTestId('learnings-scope-global-warning').textContent
  ).toMatch(/public repositories/i)
})

describe('LUM-1137 pause automatic review after N reviewed commits', () => {
  const pauseAfter = () =>
    screen.getByRole('spinbutton', {
      name: 'Pause automatic review after',
    }) as HTMLInputElement

  it('shows the stored value (default 5) and saves a change with the other switches', async () => {
    renderCard()
    expect(pauseAfter().value).toBe('5')
    fireEvent.change(pauseAfter(), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateSecurityScan).toHaveBeenCalledWith(
        expect.objectContaining({ securityReviewAutoPauseAfter: 0 })
      )
    )
  })

  it('LUM-1137 fix: can be cleared and retyped; leaving it empty shows the saved value again', async () => {
    renderCard()
    fireEvent.change(pauseAfter(), { target: { value: '' } })
    expect(pauseAfter().value).toBe('')
    fireEvent.change(pauseAfter(), { target: { value: '12' } })
    expect(pauseAfter().value).toBe('12')
    fireEvent.change(pauseAfter(), { target: { value: '' } })
    fireEvent.blur(pauseAfter())
    expect(pauseAfter().value).toBe('12')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateSecurityScan).toHaveBeenCalledWith(
        expect.objectContaining({ securityReviewAutoPauseAfter: 12 })
      )
    )
  })

  it('clamps to 0–100 and is locked while the scan is off', () => {
    renderCard()
    fireEvent.change(pauseAfter(), { target: { value: '250' } })
    expect(pauseAfter().value).toBe('100')
    fireEvent.click(toggle('Security scan'))
    expect(pauseAfter()).toBeDisabled()
  })
})
