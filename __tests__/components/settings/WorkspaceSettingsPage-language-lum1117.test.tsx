/**
 * LUM-1117 — Settings → Workspace has one language setting: the default
 * language (which AI summaries now use too). The AI summary card keeps its
 * on/off switch and frequency but no longer has a "Report language" select,
 * and saving it sends no summary-only language.
 */
import { render, screen } from '@testing-library/react'
import { WorkspaceSettingsPage } from '@/app/workspace/[workspaceUrl]/components/pages/WorkspaceSettingsPage'
import { workspacesClient } from '@/lib/api-client'

// LUM-1265: this suite is about the form's logic, not the dropdown — drive
// the shadcn Select as a native <select> (see the helper for why).
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
  () => ({ DataRetentionSection: () => null })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/settings/WorkspaceExportCard',
  () => ({ WorkspaceExportCard: () => null })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/settings/WorkspaceDeletionRow',
  () => ({ WorkspaceDeletionRow: () => null })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/settings/AiDerivedContentDeleteRow',
  () => ({ AiDerivedContentDeleteRow: () => null })
)
jest.mock('@/lib/plugins/client', () => ({
  PluginSlot: () => null,
  hasPluginSlot: () => false,
}))

const getMe = workspacesClient.getMe as jest.Mock
const updateMe = workspacesClient.updateMe as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  getMe.mockResolvedValue({
    role: 'OWNER',
    workspace: {
      id: 'ws1',
      name: 'Acme',
      slug: 'acme',
      summaryEnabled: true,
      summaryFrequency: 'DAILY',
      defaultLocale: 'zh-CN',
    },
  })
  updateMe.mockResolvedValue({
    workspace: { summaryEnabled: true, summaryFrequency: 'WEEKLY' },
  })
})

it('shows one language setting — the default language', async () => {
  render(<WorkspaceSettingsPage />)
  const select = (await screen.findByLabelText(
    'Default language'
  )) as HTMLSelectElement
  expect(select.value).toBe('zh-CN')

  // LUM-1228: the briefing-schedule card (and its frequency select) is gone.
  const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
  expect(selects).toHaveLength(1)
  expect(screen.queryByText('Report Language')).toBeNull()
  expect(screen.queryByRole('option', { name: 'Chinese' })).toBeNull()
  expect(screen.getByText(/and AI summaries/)).toBeTruthy()
})

it('no longer offers the workspace briefing schedule (LUM-1228)', async () => {
  render(<WorkspaceSettingsPage />)
  await screen.findByLabelText('Default language')
  expect(screen.queryByRole('switch')).toBeNull()
  expect(
    screen
      .queryAllByRole('combobox')
      .some(s => (s as HTMLSelectElement).value === 'DAILY')
  ).toBe(false)
  expect(updateMe).not.toHaveBeenCalled()
})
