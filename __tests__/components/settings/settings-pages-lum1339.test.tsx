/**
 * LUM-1339 — the old single Workspace page (LUM-1327) split into one page per
 * area. Each page mounts only its own cards; every one of them stays
 * OWNER-only (anyone else is sent to Members); the Code review pages need the
 * security plugin and fall back to General without it.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { GeneralSettingsPage } from '@/app/workspace/[workspaceUrl]/components/pages/GeneralSettingsPage'
import {
  AiSettingsPage,
  CodeReviewSettingsPage,
  DataRetentionSettingsPage,
  DoneRequirementsSettingsPage,
  ExportSettingsPage,
} from '@/app/workspace/[workspaceUrl]/components/pages/OwnerSettingsPages'
import { AccountSettingsPage } from '@/app/workspace/[workspaceUrl]/components/pages/PersonalSettingsPages'
import { workspacesClient } from '@/lib/api-client'
import { hasPluginSlot } from '@/lib/plugins/client'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      formatMessage: ({ id }: { id: string }) => {
        const text = messages[id]
        if (text === undefined) throw new Error(`missing message ${id}`)
        return text
      },
    }),
  }
})
const mockReplace = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  useParams: () => ({ workspaceUrl: 'acme' }),
}))
jest.mock('@/lib/api-client', () => ({
  workspacesClient: {
    getMe: jest.fn(),
    updateMe: jest.fn(),
    uploadLogo: jest.fn(),
  },
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/components/LogoUploader', () => ({ LogoUploader: () => null }))

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/settings/DefaultLanguageRow',
  () => ({
    DefaultLanguageRow: () => <div>language-row</div>,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/settings/DataRetentionSection',
  () => ({
    DataRetentionSection: () => <div>retention-card</div>,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/settings/WorkspaceExportCard',
  () => ({
    WorkspaceExportCard: () => <div>export-card</div>,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/settings/WorkspaceDeletionRow',
  () => ({
    WorkspaceDeletionRow: () => <div>deletion-row</div>,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/settings/AiDerivedContentRow',
  () => ({
    AiDerivedContentRow: () => <div>ai-derived-row</div>,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/settings/AiDerivedContentDeleteRow',
  () => ({
    AiDerivedContentDeleteRow: () => <div>ai-delete-row</div>,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/settings/AiFeaturesSection',
  () => ({
    AiFeaturesSection: () => <div>ai-features</div>,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/settings/DoneRequirementsCard',
  () => ({
    DoneRequirementsCard: () => <div>done-requirements-card</div>,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/pages/ProfileSettings',
  () => ({
    ProfileSettings: () => <div>profile-fields</div>,
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/pages/PreferencesSettings',
  () => ({ PreferencesSettings: () => <div>preference-fields</div> })
)
jest.mock('@/lib/plugins/client', () => ({
  PluginSlot: ({ name }: { name: string }) => <div>slot:{name}</div>,
  hasPluginSlot: jest.fn(),
}))

const getMe = workspacesClient.getMe as jest.Mock
const hasSlot = hasPluginSlot as jest.Mock

function owner() {
  getMe.mockResolvedValue({
    role: 'OWNER',
    workspace: { id: 'ws1', name: 'Acme', slug: 'acme', defaultLocale: 'en' },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  localStorage.clear()
  hasSlot.mockReturnValue(true)
  owner()
})

it('General holds the identity rows and only the workspace deletion', async () => {
  render(<GeneralSettingsPage />)
  await screen.findByText('language-row')
  expect(
    screen.getByRole('heading', { level: 1, name: 'General' })
  ).toBeTruthy()
  expect(screen.getByLabelText('Name')).toBeTruthy()
  expect(screen.getByLabelText('URL')).toBeTruthy()
  expect(screen.getByText('Danger zone')).toBeTruthy()
  expect(screen.getByText('deletion-row')).toBeTruthy()
  // Everything else moved to its own page.
  for (const gone of [
    'ai-delete-row',
    'retention-card',
    'export-card',
    'done-requirements-card',
    'ai-features',
  ]) {
    expect(screen.queryByText(gone)).toBeNull()
  }
})

it('AI puts the feature switches, the content switch and its delete on one page', async () => {
  render(<AiSettingsPage />)
  await screen.findByText('ai-features')
  expect(screen.getByRole('heading', { level: 1, name: 'AI' })).toBeTruthy()
  expect(screen.getByText('ai-derived-row')).toBeTruthy()
  const danger = document.getElementById('danger-zone')!
  expect(danger.textContent).toContain('ai-delete-row')
  expect(danger.textContent).not.toContain('deletion-row')
})

it.each([
  [DataRetentionSettingsPage, 'Data retention', 'retention-card'],
  [ExportSettingsPage, 'Export', 'export-card'],
  [DoneRequirementsSettingsPage, 'Done requirements', 'done-requirements-card'],
] as const)(
  '%p shows its one card under its title',
  async (Page, title, card) => {
    render(<Page />)
    await screen.findByText(card)
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy()
  }
)

it.each([
  ['settings.codeReview.behavior', 'Review behavior'],
  ['settings.codeReview.repositories', 'Repositories'],
  ['settings.codeReview.rules', 'Rule coverage'],
] as const)(
  'Code review → %s mounts only its own plugin slot',
  async (slot, title) => {
    render(<CodeReviewSettingsPage slot={slot} />)
    await screen.findByText(`slot:${slot}`)
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy()
    expect(screen.getAllByText(/^slot:/)).toHaveLength(1)
  }
)

it('a Code review page without the plugin goes back to General', async () => {
  hasSlot.mockReturnValue(false)
  render(<CodeReviewSettingsPage slot='settings.codeReview.rules' />)
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith('/workspace/acme/settings/general')
  )
  expect(screen.queryByText(/^slot:/)).toBeNull()
})

it.each([
  ['General', GeneralSettingsPage],
  ['AI', AiSettingsPage],
  ['Data retention', DataRetentionSettingsPage],
  ['Export', ExportSettingsPage],
  ['Done requirements', DoneRequirementsSettingsPage],
] as const)(
  '%s sends a non-owner to Members and shows them no card',
  async (_name, Page) => {
    getMe.mockResolvedValue({
      role: 'MEMBER',
      workspace: { id: 'ws1', name: 'Acme', slug: 'acme' },
    })
    render(<Page />)
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        '/workspace/acme/settings/members'
      )
    )
    for (const card of [
      'deletion-row',
      'ai-delete-row',
      'retention-card',
      'export-card',
      'done-requirements-card',
    ]) {
      expect(screen.queryByText(card)).toBeNull()
    }
  }
)

it('Account stacks profile and preferences, the latter at #preferences', () => {
  render(<AccountSettingsPage />)
  expect(
    screen.getByRole('heading', { level: 1, name: 'Account' })
  ).toBeTruthy()
  expect(screen.getByText('profile-fields')).toBeTruthy()
  expect(document.getElementById('preferences')?.textContent).toContain(
    'preference-fields'
  )
})
