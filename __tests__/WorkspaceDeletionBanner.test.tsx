import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { WorkspaceDeletionBanner } from '@/app/workspace/[workspaceUrl]/components/WorkspaceDeletionBanner'
import { usePendingDeletion } from '@/app/workspace/[workspaceUrl]/hooks/usePendingDeletion'

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, string>) =>
      values?.date ? `${id}:${values.date}` : id,
    formatDate: (d: string) => `date(${d})`,
  }),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/usePendingDeletion', () => ({
  usePendingDeletion: jest.fn(),
}))

const mockHook = usePendingDeletion as jest.Mock
const PENDING = {
  requestedAt: '2026-10-01T00:00:00.000Z',
  executeAt: '2026-10-03T00:00:00.000Z',
  requestedByClerkId: 'u1',
}

describe('WorkspaceDeletionBanner (LUM-918)', () => {
  it('renders nothing when no deletion is pending', () => {
    mockHook.mockReturnValue({
      pendingDeletion: null,
      isOwner: true,
      cancel: jest.fn(),
    })
    const { container } = render(<WorkspaceDeletionBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows every member the deadline, without a cancel button for a member', () => {
    mockHook.mockReturnValue({
      pendingDeletion: PENDING,
      isOwner: false,
      cancel: jest.fn(),
    })
    render(<WorkspaceDeletionBanner />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'workspaceDeletion.bannerPending:date(2026-10-03T00:00:00.000Z)'
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('lets an owner cancel from the banner', async () => {
    const cancel = jest.fn().mockResolvedValue(undefined)
    mockHook.mockReturnValue({
      pendingDeletion: PENDING,
      isOwner: true,
      cancel,
    })
    render(<WorkspaceDeletionBanner />)
    fireEvent.click(
      screen.getByRole('button', { name: 'workspaceDeletion.cancel' })
    )
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
  })
})
