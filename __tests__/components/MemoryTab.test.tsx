/** @jest-environment jsdom */
const en: Record<string, string> = {
  'memory.action.add': 'Add memory',
  'memory.tab.empty.title': 'No memories yet',
  'memory.tab.empty.description': 'Memories accumulate as you work.',
  'memory.tab.empty.cta': 'Add the first memory',
  'memory.tab.count': '{count} memories',
  'memory.action.edit': 'Edit',
  'memory.action.delete': 'Delete',
  'memory.action.promote': 'Promote to project',
  'memory.action.menu': 'Memory actions',
  'memory.source.auto': 'Sedimented by Claude',
  'agentRun.loading': '加载中…',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      (en[id] ?? id).replace(/\{(\w+)\}/g, (_, k) => String(values?.[k] ?? '')),
  }),
}))

const mockUseMemories = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMemories', () => ({
  useMemories: (...a: any[]) => mockUseMemories(...a),
}))

import { render, screen } from '@testing-library/react'
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

  it('renders a card per memory row (newest order preserved from hook)', () => {
    mockUseMemories.mockReturnValue({
      ...hookBase,
      memories: [
        { id: 'm1', scope: 'TASK', category: 'TRAP', content: { trigger: 'do X', outcome: 'breaks' }, taskId: 't1', createdByMemberId: null, createdAt: 'a', updatedAt: 'a' },
      ],
    })
    render(<MemoryTab scope='task' parentId='t1' enabled />)
    expect(screen.getByText('do X')).toBeInTheDocument()
  })

  it('shows a loading state', () => {
    mockUseMemories.mockReturnValue({ ...hookBase, loading: true })
    render(<MemoryTab scope='project' parentId='p1' enabled />)
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })

  it('shows an error state', () => {
    mockUseMemories.mockReturnValue({ ...hookBase, error: 'boom' })
    render(<MemoryTab scope='project' parentId='p1' enabled />)
    expect(screen.getByText('boom')).toBeInTheDocument()
  })
})
