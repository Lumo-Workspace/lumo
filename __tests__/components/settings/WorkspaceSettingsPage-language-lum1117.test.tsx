/**
 * LUM-1117 — Settings → Workspace has one language setting: the default
 * language (which AI summaries now use too). The AI summary card keeps its
 * on/off switch and frequency but no longer has a "Report language" select,
 * and saving it sends no summaryLocale.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { WorkspaceSettingsPage } from '@/app/workspace/[workspaceUrl]/components/pages/WorkspaceSettingsPage'
import { workspacesClient } from '@/lib/api-client'

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
  '@/app/workspace/[workspaceUrl]/components/settings/WorkspaceDeletionCard',
  () => ({ WorkspaceDeletionCard: () => null })
)
jest.mock('@/lib/plugins/client', () => ({ PluginSlot: () => null }))

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
      summaryLocale: 'zh',
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

  // The summary card's only select is the frequency one.
  const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
  expect(selects).toHaveLength(2)
  expect(selects.filter(s => s.value === 'DAILY')).toHaveLength(1)
  expect(screen.queryByText('Report Language')).toBeNull()
  expect(screen.queryByRole('option', { name: 'Chinese' })).toBeNull()
  expect(screen.getByText(/AI summaries use it too/)).toBeTruthy()
})

it('saving the summary settings sends no summaryLocale', async () => {
  render(<WorkspaceSettingsPage />)
  await screen.findByLabelText('Default language')
  const frequency = screen
    .getAllByRole('combobox')
    .find(s => (s as HTMLSelectElement).value === 'DAILY')!
  fireEvent.change(frequency, { target: { value: 'WEEKLY' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(updateMe).toHaveBeenCalledTimes(1))
  expect(updateMe).toHaveBeenCalledWith({
    summaryEnabled: true,
    summaryFrequency: 'WEEKLY',
  })
})
