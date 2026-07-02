/** @jest-environment jsdom */

/**
 * Mock react-intl to avoid the untranspiled-ESM transform issue under jest
 * (react-intl ships ESM and next/jest excludes node_modules from transform),
 * matching the convention used by the sibling Link*Popover tests.
 * formatMessage returns the message id so intl-driven copy never collides with
 * the artifact title/kind text the assertions target (the group label "Spec"
 * would otherwise clash with the "Spec" artifact title).
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
    formatDate: () => 'Jan 1',
  }),
}))

jest.mock('@/lib/api-client/task-artifacts', () => ({
  artifactsClient: {
    list: jest.fn(),
    add: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  },
}))

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SpecArtifactGroup } from '@/app/workspace/[workspaceUrl]/components/SpecArtifactGroup'
import { artifactsClient } from '@/lib/api-client/task-artifacts'

const mockList = artifactsClient.list as jest.Mock
const mockUpdate = artifactsClient.update as jest.Mock
const mockRemove = artifactsClient.remove as jest.Mock

const artifacts = [
  {
    id: 'a1',
    taskId: 't1',
    workspaceId: 'w1',
    kind: 'spec',
    title: 'Spec',
    content: 'body one',
    source: 'superpowers',
    agent: 'CLAUDE_CODE',
    order: 0,
    summary: null,
    createdById: null,
    createdAt: new Date('2026-05-20T00:00:00.000Z'),
    updatedAt: new Date('2026-05-20T00:00:00.000Z'),
  },
  {
    id: 'a2',
    taskId: 't1',
    workspaceId: 'w1',
    kind: 'plan',
    title: 'Plan',
    content: 'body two',
    source: 'superpowers',
    agent: 'CODEX',
    order: 1,
    summary: null,
    createdById: null,
    createdAt: new Date('2026-05-20T00:00:00.000Z'),
    updatedAt: new Date('2026-05-20T00:00:00.000Z'),
  },
]

let queryClient: QueryClient

function renderGroup(taskId = 't1') {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <SpecArtifactGroup taskId={taskId} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockList.mockResolvedValue({ artifacts: [] })
})

describe('SpecArtifactGroup', () => {
  it('renders nothing when there are no artifacts', async () => {
    mockList.mockResolvedValue({ artifacts: [] })
    const { container } = renderGroup()
    await waitFor(() => expect(mockList).toHaveBeenCalledWith('t1'))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one row per artifact with its kind + title', async () => {
    mockList.mockResolvedValue({ artifacts })
    renderGroup()
    expect(await screen.findByText('Spec')).toBeInTheDocument()
    expect(screen.getByText('Plan')).toBeInTheDocument()
    expect(screen.getByText('spec')).toBeInTheDocument()
  })

  it('expands a row on click to reveal content', async () => {
    mockList.mockResolvedValue({ artifacts })
    renderGroup()
    await screen.findByText('Spec')
    expect(screen.queryByText('body one')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Spec'))
    expect(screen.getByText('body one')).toBeInTheDocument()
  })

  it('deletes a row via the delete button after confirming in the dialog', async () => {
    mockList.mockResolvedValue({ artifacts })
    mockRemove.mockResolvedValue(undefined)
    renderGroup()
    await screen.findByText('Spec')

    const deleteButtons = screen.getAllByRole('button', {
      name: 'taskArtifact.delete',
    })
    fireEvent.click(deleteButtons[0]!)

    // LUM-548: deletion is gated behind an AlertDialog confirm.
    const dialog = await screen.findByRole('alertdialog')
    expect(mockRemove).not.toHaveBeenCalled()
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'taskArtifact.delete' })
    )

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('t1', 'a1'))
    await waitFor(() =>
      expect(screen.queryByText('Spec')).not.toBeInTheDocument()
    )
  })

  it('edits a row metadata via the edit form', async () => {
    mockList.mockResolvedValue({ artifacts })
    mockUpdate.mockResolvedValue({
      artifact: { ...artifacts[0], title: 'Renamed' },
    })
    renderGroup()
    await screen.findByText('Spec')

    const editButtons = screen.getAllByRole('button', {
      name: 'taskArtifact.edit',
    })
    fireEvent.click(editButtons[0]!)

    const titleInput = screen.getByDisplayValue('Spec')
    fireEvent.change(titleInput, { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'taskArtifact.save' }))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('t1', 'a1', {
        kind: 'spec',
        title: 'Renamed',
        source: 'superpowers',
        agent: 'CLAUDE_CODE',
      })
    )
  })
})
