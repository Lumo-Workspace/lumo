/**
 * LUM-1327 — Settings → Workspace is grouped into titled sections (General /
 * Code review / Data & privacy / Danger zone) with jump links at the top.
 * Code review only appears when a plugin fills its slot.
 */
import { render, screen, within } from '@testing-library/react'
import { WorkspaceSettingsPage } from '@/app/workspace/[workspaceUrl]/components/pages/WorkspaceSettingsPage'
import { workspacesClient } from '@/lib/api-client'
import { hasPluginSlot } from '@/lib/plugins/client'

jest.mock('@/components/ui/select', () =>
  require('../../helpers/native-select-mock').nativeSelectMock()
)
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
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
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
  '@/app/workspace/[workspaceUrl]/components/settings/DataRetentionSection',
  () => ({ DataRetentionSection: () => <div>retention-card</div> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/settings/WorkspaceExportCard',
  () => ({ WorkspaceExportCard: () => <div>export-card</div> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/settings/WorkspaceDeletionRow',
  () => ({ WorkspaceDeletionRow: () => <div>deletion-card</div> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/settings/AiDerivedContentDeleteRow',
  () => ({ AiDerivedContentDeleteRow: () => <div>ai-delete-row</div> })
)
jest.mock('@/lib/plugins/client', () => ({
  PluginSlot: () => <div>plugin-cards</div>,
  hasPluginSlot: jest.fn(),
}))

const getMe = workspacesClient.getMe as jest.Mock
const hasSlot = hasPluginSlot as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  getMe.mockResolvedValue({
    role: 'OWNER',
    workspace: { id: 'ws1', name: 'Acme', slug: 'acme', defaultLocale: 'en' },
  })
})

function section(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`no section #${id}`)
  return el
}

it('groups the settings into titled sections with jump links', async () => {
  hasSlot.mockReturnValue(true)
  render(<WorkspaceSettingsPage />)
  await screen.findByLabelText('Default language')

  const nav = screen.getByRole('navigation', {
    name: 'Workspace settings sections',
  })
  const links = within(nav).getAllByRole('link')
  expect(links.map(a => [a.textContent, a.getAttribute('href')])).toEqual([
    ['General', '#general'],
    // LUM-1338: the AI feature switches.
    ['AI features', '#ai-features'],
    ['Code review', '#code-review'],
    ['Data & privacy', '#data-privacy'],
    ['Danger zone', '#danger-zone'],
  ])

  // Default language now lives in the General card with name and URL.
  const general = section('general')
  expect(within(general).getByLabelText('Name')).toBeTruthy()
  expect(within(general).getByLabelText('Default language')).toBeTruthy()

  expect(within(section('code-review')).getByText('plugin-cards')).toBeTruthy()
  const data = section('data-privacy')
  expect(within(data).getByText('retention-card')).toBeTruthy()
  expect(within(data).getByText('export-card')).toBeTruthy()
  // Both irreversible actions sit in the danger zone, not in Data & privacy.
  const danger = section('danger-zone')
  expect(within(danger).getByText('Danger zone')).toBeTruthy()
  expect(within(danger).getByText('ai-delete-row')).toBeTruthy()
  expect(within(danger).getByText('deletion-card')).toBeTruthy()
  expect(within(data).queryByText('ai-delete-row')).toBeNull()
})

it('drops the Code review section when no plugin fills the slot', async () => {
  hasSlot.mockReturnValue(false)
  render(<WorkspaceSettingsPage />)
  await screen.findByLabelText('Default language')

  expect(document.getElementById('code-review')).toBeNull()
  expect(screen.queryByRole('link', { name: 'Code review' })).toBeNull()
  expect(screen.queryByText('plugin-cards')).toBeNull()
  expect(hasSlot).toHaveBeenCalledWith('settings.workspace.section')
})
