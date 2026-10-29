/**
 * LUM-1327 — the settings shell's <main> is overflow-hidden, so every
 * settings page must be its own scroll container. Tags, Trash and Sprints
 * were not, and long lists could not be scrolled.
 */
import { render, screen } from '@testing-library/react'
import { TagsSettingsPage } from '@/app/workspace/[workspaceUrl]/components/pages/TagsSettingsPage'
import { TrashSettingsPage } from '@/app/workspace/[workspaceUrl]/components/pages/TrashSettingsPage'
import SprintsSettingsPage from '@/app/workspace/[workspaceUrl]/settings/sprints/page'
import { useTrash } from '@/app/workspace/[workspaceUrl]/hooks/useTrash'

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
    formatDate: (d: string) => d,
  }),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/api-client', () => ({
  tagsClient: { list: jest.fn().mockResolvedValue({ tags: [] }) },
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTrash', () => ({
  useTrash: jest.fn(),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/settings/sprints/SettingsSprintsClient',
  () => ({ SettingsSprintsClient: () => <div>sprints</div> })
)

beforeEach(() => {
  ;(useTrash as jest.Mock).mockReturnValue({
    items: [],
    isLoading: false,
    isError: false,
  })
})

function expectScrollRoot(container: HTMLElement) {
  const root = container.firstElementChild as HTMLElement
  expect(root.className).toContain('h-full')
  expect(root.className).toContain('overflow-y-auto')
}

it('Tags page is its own scroll container', async () => {
  const { container } = render(<TagsSettingsPage />)
  await screen.findByText('settings.tags.empty')
  expectScrollRoot(container)
})

it('Trash page is its own scroll container', () => {
  const { container } = render(<TrashSettingsPage />)
  expectScrollRoot(container)
})

it('Sprints settings page is its own scroll container', () => {
  const { container } = render(<SprintsSettingsPage />)
  expectScrollRoot(container)
})
