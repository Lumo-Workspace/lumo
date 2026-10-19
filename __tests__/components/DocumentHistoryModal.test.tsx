import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { DocumentHistoryModal } from '@/app/workspace/[workspaceUrl]/components/documents/DocumentHistoryModal'

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (d: { defaultMessage?: string }) => d.defaultMessage ?? '',
    formatDate: (v: unknown) => String(v),
    locale: 'en',
  }),
}))

const hook = {
  revisions: [
    {
      id: 'r2',
      label: null,
      isManual: false,
      title: 'T',
      emoji: null,
      wordCount: 3,
      createdAt: '2026-06-05T11:00:00Z',
      updatedAt: '2026-06-05T11:00:00Z',
      author: { id: 'm1', name: 'Alex', imageUrl: null },
    },
    {
      id: 'r1',
      label: 'v1 review',
      isManual: true,
      title: 'T',
      emoji: null,
      wordCount: 2,
      createdAt: '2026-06-04T10:00:00Z',
      updatedAt: '2026-06-04T10:00:00Z',
      author: { id: 'm1', name: 'Alex', imageUrl: null },
    },
  ],
  loading: false,
  error: null,
  getRevision: jest.fn().mockResolvedValue({ id: 'r2', content: '<p>old</p>' }),
  createManual: jest.fn(),
  restore: jest.fn().mockResolvedValue({ id: 'd1' }),
  refresh: jest.fn(),
}
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useDocumentRevisions', () => ({
  useDocumentRevisions: () => hook,
}))

function renderModal(onRestored = jest.fn(), onClose = jest.fn()) {
  return render(
    <DocumentHistoryModal
      open
      documentId='d1'
      currentHtml='<p>current</p>'
      onClose={onClose}
      onRestored={onRestored}
    />
  )
}

beforeEach(() => jest.clearAllMocks())

it('lists revisions with a manual-version badge', async () => {
  renderModal()
  expect(await screen.findByText('v1 review')).toBeInTheDocument()
  expect(screen.getAllByText('Alex').length).toBeGreaterThan(0)
})

it('restores the selected revision and calls onRestored', async () => {
  const onRestored = jest.fn()
  renderModal(onRestored)
  fireEvent.click(await screen.findByText('v1 review'))
  fireEvent.click(screen.getByRole('button', { name: /restore/i }))
  await waitFor(() => expect(hook.restore).toHaveBeenCalledWith('r1'))
  await waitFor(() => expect(onRestored).toHaveBeenCalled())
})

// LUM-1264: the modal is a Radix Dialog — standard scrim, focus trap, Esc.
it('renders as a labelled dialog over the standard scrim', async () => {
  renderModal()
  const dialog = await screen.findByRole('dialog', { name: 'Version history' })
  expect(dialog).toBeInTheDocument()
  expect(document.querySelector('.bg-black\\/50')).not.toBeNull()
})

it('closes on Esc', async () => {
  const onClose = jest.fn()
  renderModal(jest.fn(), onClose)
  fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' })
  expect(onClose).toHaveBeenCalled()
})

it('renders nothing while closed', () => {
  render(
    <DocumentHistoryModal
      open={false}
      documentId='d1'
      currentHtml={null}
      onClose={jest.fn()}
      onRestored={jest.fn()}
    />
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
