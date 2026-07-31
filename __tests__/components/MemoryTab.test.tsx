/** @jest-environment jsdom */
const en: Record<string, string> = {
  'memory.action.add': 'New memory',
  'memory.tab.empty.title': 'No memories yet',
  'memory.tab.empty.description': 'Memories accumulate as you work.',
  'memory.tab.count': '{count} memories',
  'memory.action.edit': 'Edit',
  'memory.action.delete': 'Delete',
  'memory.action.promote': 'Promote to project',
  'memory.action.menu': 'Memory actions',
  'memory.source.auto': 'Sedimented by Claude',
  'memory.source.byMember': 'Added by {name}',
  'agentRun.loading': '加载中…',
  // dialog keys needed for submit-error test
  'memory.dialog.create.title': 'Add memory',
  'memory.dialog.create.cta': 'Create',
  'memory.dialog.edit.title': 'Edit memory',
  'memory.dialog.edit.cta': 'Save changes',
  'memory.dialog.cancel': 'Cancel',
  'memory.field.summary.label': 'Title',
  'memory.category.trap': 'Trap',
  'memory.category.decision': 'Decision',
  'memory.category.convention': 'Convention',
  'memory.category.procedural': 'Procedure',
  'memory.section.trigger': 'Trigger',
  'memory.section.outcome': 'Outcome',
  'memory.section.workaround': 'Workaround',
  'memory.mutation.error': 'Failed to save memory. Please try again.',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      (en[id] ?? id).replace(/\{(\w+)\}/g, (_, k) => String(values?.[k] ?? '')),
  }),
}))

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))

const mockUseMemories = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMemories', () => ({
  useMemories: (...a: any[]) => mockUseMemories(...a),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useFragmentTrust', () => ({
  useFragmentTrust: () => ({}),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useRetireCandidates', () => ({
  useRetireCandidates: () => ({
    candidates: [],
    confirmRetire: jest.fn(),
    confirming: false,
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMergeCandidates', () => ({
  useMergeCandidates: () => ({
    candidates: [],
    confirmMerge: jest.fn(),
    confirming: false,
  }),
}))

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { MemoryTab } from '@/app/workspace/[workspaceUrl]/components/memory/MemoryTab'

const hookBase = {
  memories: [],
  loading: false,
  error: null as string | null,
  refetch: jest.fn(),
  create: jest.fn(),
  edit: jest.fn(),
  promote: jest.fn(),
  remove: jest.fn(),
  mutating: false,
}

beforeEach(() => jest.clearAllMocks())

describe('MemoryTab', () => {
  it('renders the empty state when there are no memories', () => {
    mockUseMemories.mockReturnValue({ ...hookBase, memories: [] })
    render(<MemoryTab scope='task' parentId='t1' enabled />)
    expect(screen.getByText('No memories yet')).toBeInTheDocument()
  })

  it('hides the header chrome when empty so only the empty-state CTA shows (no duplicate)', () => {
    mockUseMemories.mockReturnValue({ ...hookBase, memories: [] })
    render(<MemoryTab scope='task' parentId='t1' enabled />)
    // The empty state owns the single add CTA — it reuses the header's wording
    // ("New memory"), so the duplicate check is on the count: exactly one.
    expect(screen.getAllByRole('button', { name: /New memory/ })).toHaveLength(
      1
    )
    // The header count must NOT also render — that would duplicate the
    // "no memories" message.
    expect(screen.queryByText('0 memories')).not.toBeInTheDocument()
  })

  it('renders a card per memory row (newest order preserved from hook)', () => {
    mockUseMemories.mockReturnValue({
      ...hookBase,
      memories: [
        {
          id: 'm1',
          scope: 'TASK',
          category: 'TRAP',
          content: { trigger: 'do X', outcome: 'breaks' },
          taskId: 't1',
          createdByMemberId: null,
          createdAt: 'a',
          updatedAt: 'a',
        },
      ],
    })
    render(<MemoryTab scope='task' parentId='t1' enabled />)
    expect(screen.getByText('do X')).toBeInTheDocument()
  })

  it('renders the header "New memory" button, which opens the create dialog', () => {
    mockUseMemories.mockReturnValue({
      ...hookBase,
      memories: [
        {
          id: 'm1',
          scope: 'TASK',
          category: 'TRAP',
          content: { trigger: 'do X', outcome: 'breaks' },
          taskId: 't1',
          createdByMemberId: null,
          createdAt: 'a',
          updatedAt: 'a',
        },
      ],
    })
    render(<MemoryTab scope='task' parentId='t1' enabled />)
    const addButton = screen.getByRole('button', { name: 'New memory' })
    fireEvent.click(addButton)
    expect(
      screen.getByRole('heading', { name: 'Add memory' })
    ).toBeInTheDocument()
  })

  it('filters out rows whose content fails to parse (orphan-row guard)', () => {
    mockUseMemories.mockReturnValue({
      ...hookBase,
      memories: [
        {
          id: 'good',
          scope: 'TASK',
          category: 'TRAP',
          content: { trigger: 'valid X', outcome: 'breaks' },
          taskId: 't1',
          createdByMemberId: null,
          createdAt: 'a',
          updatedAt: 'a',
        },
        // missing required `outcome` → parseMemoryContent throws → must be dropped
        {
          id: 'bad',
          scope: 'TASK',
          category: 'TRAP',
          content: { trigger: 'orphan' },
          taskId: 't1',
          createdByMemberId: null,
          createdAt: 'a',
          updatedAt: 'a',
        },
      ],
    })
    render(<MemoryTab scope='task' parentId='t1' enabled />)
    expect(screen.getByText('valid X')).toBeInTheDocument()
    expect(screen.queryByText('orphan')).not.toBeInTheDocument()
    // count reflects only the parseable row
    expect(screen.getByText('1 memories')).toBeInTheDocument()
  })

  it('resolves "Added by <name>" from the memberNames map', () => {
    mockUseMemories.mockReturnValue({
      ...hookBase,
      memories: [
        {
          id: 'm1',
          scope: 'TASK',
          category: 'TRAP',
          content: { trigger: 'do X', outcome: 'breaks' },
          taskId: 't1',
          createdByMemberId: 'mem1',
          createdAt: 'a',
          updatedAt: 'a',
        },
      ],
    })
    render(
      <MemoryTab
        scope='task'
        parentId='t1'
        enabled
        memberNames={new Map([['mem1', 'Alice']])}
      />
    )
    expect(screen.getByText('Added by Alice')).toBeInTheDocument()
  })

  it('shows a loading state', () => {
    mockUseMemories.mockReturnValue({ ...hookBase, loading: true })
    render(<MemoryTab scope='project' parentId='p1' enabled />)
    expect(screen.getByTestId('memory-skeleton')).toBeInTheDocument()
  })

  it('shows an error state', () => {
    mockUseMemories.mockReturnValue({ ...hookBase, error: 'boom' })
    render(<MemoryTab scope='project' parentId='p1' enabled />)
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('keeps the dialog open and shows a toast when create rejects', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    const rejectedCreate = jest.fn().mockRejectedValue(new Error('boom'))
    mockUseMemories.mockReturnValue({
      ...hookBase,
      create: rejectedCreate,
      memories: [],
    })

    render(<MemoryTab scope='task' parentId='t1' enabled />)

    // Open create dialog via the empty-state CTA (header is hidden when empty)
    fireEvent.click(screen.getByRole('button', { name: /New memory/ }))

    // TRAP is the dialog's default category — its fields are already on screen.
    // Fill in the required fields (trigger + outcome)
    fireEvent.change(screen.getByLabelText(/Trigger/), {
      target: { value: 'do something' },
    })
    fireEvent.change(screen.getByLabelText(/Outcome/), {
      target: { value: 'it breaks' },
    })

    // Submit — this calls handleSubmit which calls create (which rejects)
    fireEvent.click(screen.getByRole('button', { name: /^Create/ }))

    // After rejection, the dialog should still be present (title still visible)
    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Memory mutation failed:',
        expect.any(Error)
      )
    })
    // Dialog title should still be in the document (dialog stayed open for retry)
    expect(
      screen.getByRole('heading', { name: 'Add memory' })
    ).toBeInTheDocument()
    expect(toast.error as jest.Mock).toHaveBeenCalled()

    consoleError.mockRestore()
  })
})
