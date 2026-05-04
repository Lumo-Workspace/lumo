import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

const getMemoriesMock = jest.fn()

jest.mock('@/lib/api-client', () => ({
  tasksClient: {
    getMemories: (...args: unknown[]) => getMemoriesMock(...args),
  },
}))

import { TaskMemorySection } from '@/app/workspace/[workspaceUrl]/components/TaskMemorySection'

describe('TaskMemorySection', () => {
  beforeEach(() => {
    getMemoriesMock.mockReset()
  })

  it('renders nothing when there are no memories', async () => {
    getMemoriesMock.mockResolvedValue({ memories: [] })
    const { container } = render(<TaskMemorySection taskId='t1' />)
    await waitFor(() => {
      expect(container.firstChild).toBeNull()
    })
  })

  it('renders all four categories with their content', async () => {
    getMemoriesMock.mockResolvedValue({
      memories: [
        {
          id: '1',
          category: 'TRAP',
          content: {
            trigger: 'taskId immutability',
            outcome: 'Session reassign fails',
            workaround: 'Always create new session',
          },
          createdAt: '2026-05-01T00:00:00Z',
        },
        {
          id: '2',
          category: 'DECISION',
          content: { what: 'Use Pusher', why: 'Real-time updates' },
          createdAt: '2026-05-01T00:00:00Z',
        },
        {
          id: '3',
          category: 'CONVENTION',
          content: { rule: 'Branch lumo/{id}', scope: 'all repos' },
          createdAt: '2026-05-01T00:00:00Z',
        },
        {
          id: '4',
          category: 'PROCEDURAL',
          content: {
            workflow: 'verify plan',
            trigger: 'before exec',
            steps: ['read schema', 'check enums'],
          },
          createdAt: '2026-05-01T00:00:00Z',
        },
      ],
    })
    render(<TaskMemorySection taskId='t1' />)

    await waitFor(() => {
      expect(screen.getByText('Memory')).toBeInTheDocument()
    })
    expect(screen.getByText('Traps')).toBeInTheDocument()
    expect(screen.getByText('Decisions')).toBeInTheDocument()
    expect(screen.getByText('Conventions')).toBeInTheDocument()
    expect(screen.getByText('Procedures')).toBeInTheDocument()
    expect(screen.getByText('taskId immutability')).toBeInTheDocument()
    expect(screen.getByText('Use Pusher')).toBeInTheDocument()
    expect(screen.getByText('Branch lumo/{id}')).toBeInTheDocument()
    expect(screen.getByText('verify plan')).toBeInTheDocument()
    expect(
      screen.getByText('Workaround: Always create new session')
    ).toBeInTheDocument()
    expect(screen.getByText('read schema → check enums')).toBeInTheDocument()
  })

  it('renders unparseable memories with a fallback', async () => {
    getMemoriesMock.mockResolvedValue({
      memories: [
        {
          id: 'bad',
          category: 'TRAP',
          content: { foo: 'bar' },
          createdAt: '2026-05-01T00:00:00Z',
        },
      ],
    })
    render(<TaskMemorySection taskId='t1' />)
    await waitFor(() => {
      expect(
        screen.getByText('(unparseable memory content)')
      ).toBeInTheDocument()
    })
  })
})
