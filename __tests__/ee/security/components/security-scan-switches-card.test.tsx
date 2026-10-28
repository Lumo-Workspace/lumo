/** @jest-environment jsdom */
/**
 * LUM-866 — the settings card for the PR security-scan switches.
 * LUM-1002 — saves go to /api/workspaces/me/security-scan. LUM-1327: the
 * scan switch sits in the card header (no more disable/enable all).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// react-intl's ESM build is not loadable through jest here (repo convention:
// mock it) — resolve ids against the real en copy so labels are assertable.
// LUM-1265: this suite is about the form's logic, not the dropdown — drive
// the shadcn Select as a native <select> (see the helper for why).
jest.mock('@/components/ui/select', () =>
  require('../../../helpers/native-select-mock').nativeSelectMock()
)
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
import type { AgentReviewBlockingView } from '@/ee/security/security-scan/policy'

const updateSecurityScan = securityScanClient.updateSecurityScan as jest.Mock

const ALL_ON = {
  securityScanEnabled: true,
  securityAiReviewEnabled: true,
  securityHuntEnabled: true,
  securityRewardHackEnabled: true,
  securityRequestChangesEnabled: false,
  securityAllowAuthorApproval: true,
  securityLearningsScope: 'auto' as const,
  securityReviewAutoPauseAfter: 5,
}

/** LUM-1329 — the level the fake server holds (what renderCard started with). */
let storedAgentReview: AgentReviewBlockingView = 'off'

function renderCard(
  initial: WorkspaceSecuritySwitches = ALL_ON,
  huntAvailable = true,
  sandboxAvailable = true,
  rewardHackAvailable = true,
  agentReviewBlocking: AgentReviewBlockingView = 'off'
) {
  storedAgentReview = agentReviewBlocking
  return render(
    <SecurityScanSwitchesCard
      initial={initial}
      huntAvailable={huntAvailable}
      rewardHackAvailable={rewardHackAvailable}
      sandboxAvailable={sandboxAvailable}
      initialAgentReviewBlocking={agentReviewBlocking}
    />
  )
}

const toggle = (name: string | RegExp) => screen.getByRole('switch', { name })

beforeEach(() => {
  jest.clearAllMocks()
  updateSecurityScan.mockImplementation(
    async ({ agentReviewBlocking, ...u }: Record<string, unknown>) => {
      // LUM-1329: the server holds the level it was sent, else the one it had.
      if (agentReviewBlocking !== undefined)
        storedAgentReview = agentReviewBlocking as AgentReviewBlockingView
      return {
        agentReviewBlocking: storedAgentReview,
        switches:
          'all' in u
            ? {
                securityScanEnabled: u.all,
                securityAiReviewEnabled: u.all,
                securityHuntEnabled: u.all,
                securityRewardHackEnabled: u.all,
                securityRequestChangesEnabled: false,
                securityAllowAuthorApproval: true,
                securityLearningsScope: 'auto' as const,
                securityReviewAutoPauseAfter: 5,
              }
            : { ...ALL_ON, ...u },
      }
    }
  )
})

describe('LUM-866 SecurityScanSwitchesCard', () => {
  it('renders the three switches from the stored values', () => {
    renderCard({ ...ALL_ON, securityAiReviewEnabled: false })
    expect(toggle('Pull request review')).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(toggle('AI review')).toHaveAttribute('aria-checked', 'false')
    expect(toggle('Exploitability check')).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('turning the scan off shows AI review and hunt off and locked', () => {
    renderCard()
    fireEvent.click(toggle('Pull request review'))
    expect(toggle('AI review')).toBeDisabled()
    expect(toggle('AI review')).toHaveAttribute('aria-checked', 'false')
    expect(toggle('Exploitability check')).toBeDisabled()
    expect(toggle('Exploitability check')).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('a hunt the platform turned off is off, locked and explained', () => {
    renderCard(ALL_ON, false)
    expect(toggle('Exploitability check')).toBeDisabled()
    expect(toggle('Exploitability check')).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(
      screen.getByText('Currently turned off for all workspaces by Lumo.')
    ).toBeInTheDocument()
  })

  it('save sends every switch to the workspace settings API', async () => {
    renderCard()
    fireEvent.click(toggle('Exploitability check'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateSecurityScan).toHaveBeenCalledWith({
        securityScanEnabled: true,
        securityAiReviewEnabled: true,
        securityHuntEnabled: false,
        securityRewardHackEnabled: true,
        securityRequestChangesEnabled: false,
        securityAllowAuthorApproval: true,
        securityLearningsScope: 'auto',
        securityReviewAutoPauseAfter: 5,
      })
    )
  })

  it('LUM-1327 Save shows only once something changed', () => {
    renderCard()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    fireEvent.click(toggle('AI review'))
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    fireEvent.click(toggle('AI review'))
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('LUM-1327 the header switch replaces "Disable all" and turns everything off', async () => {
    renderCard()
    expect(screen.queryByRole('button', { name: 'Disable all' })).toBeNull()
    fireEvent.click(toggle('Pull request review'))
    expect(toggle('AI review')).toHaveAttribute('aria-checked', 'false')
    expect(toggle('Agent shortcut check')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateSecurityScan).toHaveBeenCalledWith(
        expect.objectContaining({ securityScanEnabled: false })
      )
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    )
  })

  it('LUM-1327 groups the rows under two sub-headings', () => {
    renderCard()
    expect(
      screen.getByText('Extra checks on each pull request')
    ).toBeInTheDocument()
    expect(screen.getByText('How Lumo reviews')).toBeInTheDocument()
  })
})

describe('LUM-1025 SecurityScanSwitchesCard without Vercel Sandbox', () => {
  it('locks the hunt and says the deployment lacks Sandbox, not that Lumo turned it off', () => {
    renderCard(ALL_ON, false, false)
    expect(toggle('Exploitability check')).toBeDisabled()
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
    fireEvent.click(toggle('Pull request review'))
    expect(rc()).toBeDisabled()
    expect(rc()).toHaveAttribute('aria-checked', 'false')
  })
})

describe('LUM-1142 author approval switch', () => {
  const aa = () => toggle('Let PR authors resolve and approve')

  it('is on by default and an OWNER turns it off with Save', async () => {
    renderCard()
    expect(aa()).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(aa())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateSecurityScan).toHaveBeenCalledWith(
        expect.objectContaining({ securityAllowAuthorApproval: false })
      )
    )
  })
})

describe('LUM-1134 learnings scope', () => {
  const scope = () =>
    screen.getByRole('combobox', {
      name: 'Learnings to use',
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
    fireEvent.click(toggle('Pull request review'))
    expect(scope()).toBeDisabled()
  })
})

it('LUM-1134 choosing global warns that public repositories may draw on private ones', () => {
  renderCard()
  expect(screen.queryByTestId('learnings-scope-global-warning')).toBeNull()
  fireEvent.change(screen.getByRole('combobox', { name: 'Learnings to use' }), {
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
    fireEvent.click(toggle('Pull request review'))
    expect(pauseAfter()).toBeDisabled()
  })
})

describe('LUM-1234 agent behavior (reward-hack) switch', () => {
  const rh = () => toggle(/^Agent shortcut check$/)

  it('is on by default and saved with the other switches', async () => {
    renderCard()
    expect(rh()).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(rh())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateSecurityScan).toHaveBeenCalledWith(
        expect.objectContaining({ securityRewardHackEnabled: false })
      )
    )
  })

  it('describes the check without naming a model or vendor', () => {
    renderCard()
    expect(
      screen.getByText(/gamed tests, metrics or checks/)
    ).toBeInTheDocument()
  })

  it('reads off and locked with the scan off', () => {
    renderCard({ ...ALL_ON, securityScanEnabled: false })
    expect(rh()).toBeDisabled()
    expect(rh()).toHaveAttribute('aria-checked', 'false')
  })

  it('a layer the platform has off is off, locked and explained', () => {
    renderCard(ALL_ON, true, true, false)
    expect(rh()).toBeDisabled()
    expect(rh()).toHaveAttribute('aria-checked', 'false')
    expect(
      screen.getByText('Currently turned off for all workspaces by Lumo.')
    ).toBeInTheDocument()
  })
})

describe('LUM-1329 imported agent reviews block Done', () => {
  const level = () =>
    screen.getByRole('combobox', {
      name: 'Imported agent reviews block Done',
    }) as HTMLSelectElement

  it('is off by default with the four levels, and warns only while a level blocks', () => {
    renderCard()
    expect(level().value).toBe('off')
    expect([...level().options].map(o => o.value)).toEqual([
      'off',
      'high',
      'medium',
      'low',
    ])
    expect(screen.queryByTestId('agent-review-blocking-warning')).toBeNull()
    fireEvent.change(level(), { target: { value: 'medium' } })
    expect(
      screen.getByTestId('agent-review-blocking-warning')
    ).toHaveTextContent(/blocks Done on every member’s task/)
  })

  it('changing it shows Save; an OWNER turns it on and it is saved with the switches', async () => {
    renderCard()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    fireEvent.change(level(), { target: { value: 'high' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateSecurityScan).toHaveBeenCalledWith(
        expect.objectContaining({ agentReviewBlocking: 'high' })
      )
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    )
    expect(level().value).toBe('high')
  })

  it('turns it back off', async () => {
    renderCard(ALL_ON, true, true, true, 'low')
    expect(level().value).toBe('low')
    fireEvent.change(level(), { target: { value: 'off' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateSecurityScan).toHaveBeenCalledWith(
        expect.objectContaining({ agentReviewBlocking: 'off' })
      )
    )
  })

  it('an unrelated save does not send the level, so a newer level set elsewhere is kept', async () => {
    renderCard(ALL_ON, true, true, true, 'off')
    fireEvent.click(toggle('Exploitability check'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateSecurityScan).toHaveBeenCalled())
    expect(updateSecurityScan.mock.calls[0]![0]).not.toHaveProperty(
      'agentReviewBlocking'
    )
  })

  it('a custom policy shows as custom and is not rewritten by an unrelated save', async () => {
    renderCard(ALL_ON, true, true, true, 'custom')
    expect(level().value).toBe('custom')
    fireEvent.click(toggle('Exploitability check'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateSecurityScan).toHaveBeenCalled())
    expect(updateSecurityScan.mock.calls[0]![0]).not.toHaveProperty(
      'agentReviewBlocking'
    )
  })
})

it('LUM-1329 an unrelated save keeps showing the stored level the server echoes', async () => {
  renderCard(ALL_ON, true, true, true, 'medium')
  fireEvent.click(toggle('Exploitability check'))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  )
  expect(
    (
      screen.getByRole('combobox', {
        name: 'Imported agent reviews block Done',
      }) as HTMLSelectElement
    ).value
  ).toBe('medium')
})
