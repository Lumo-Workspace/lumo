import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TrashSettingsPage } from '@/app/workspace/[workspaceUrl]/components/pages/TrashSettingsPage'
import { useTrash } from '@/app/workspace/[workspaceUrl]/hooks/useTrash'

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => (values ? `${id}:${JSON.stringify(values)}` : id),
    formatDate: (d: string) => d.slice(0, 10),
  }),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTrash', () => ({
  useTrash: jest.fn(),
}))

const mockUseTrash = useTrash as jest.Mock
const ITEM = {
  kind: 'task' as const,
  id: 't1',
  label: 'LUM-9',
  title: 'Old spike',
  emoji: null,
  deletedAt: '2026-10-01T00:00:00.000Z',
  purgeAt: '2026-10-31T00:00:00.000Z',
  descendantCount: 2,
}

describe('TrashSettingsPage (LUM-918)', () => {
  it('shows the empty state', () => {
    mockUseTrash.mockReturnValue({
      items: [],
      isLoading: false,
      isError: false,
    })
    render(<TrashSettingsPage />)
    expect(screen.getByText('settings.trash.empty')).toBeInTheDocument()
  })

  it('lists an item with its purge date and restores it', async () => {
    const restore = jest.fn().mockResolvedValue(undefined)
    mockUseTrash.mockReturnValue({
      items: [ITEM],
      isLoading: false,
      isError: false,
      restore,
      deletePermanently: jest.fn(),
    })
    render(<TrashSettingsPage />)
    expect(screen.getByText('Old spike')).toBeInTheDocument()
    expect(screen.getByText(/2026-10-31/)).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'settings.trash.restore' })
    )
    await waitFor(() => expect(restore).toHaveBeenCalledWith('task', 't1'))
  })

  it('deletes permanently only after the confirmation dialog', async () => {
    const deletePermanently = jest.fn().mockResolvedValue(undefined)
    mockUseTrash.mockReturnValue({
      items: [ITEM],
      isLoading: false,
      isError: false,
      restore: jest.fn(),
      deletePermanently,
    })
    render(<TrashSettingsPage />)
    fireEvent.click(
      screen.getByRole('button', { name: 'settings.trash.deleteForever' })
    )
    expect(deletePermanently).not.toHaveBeenCalled()
    const buttons = await screen.findAllByRole('button', {
      name: 'settings.trash.deleteForever',
    })
    fireEvent.click(buttons[buttons.length - 1]!)
    await waitFor(() =>
      expect(deletePermanently).toHaveBeenCalledWith('task', 't1')
    )
  })
})
