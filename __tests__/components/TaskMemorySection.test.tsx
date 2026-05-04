import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

const getMemoriesMock = jest.fn()

jest.mock('@/lib/api-client', () => ({
  tasksClient: {
    getMemories: (...args: unknown[]) => getMemoriesMock(...args),
  },
}))

// Mock react-intl: the real package ships ESM that Jest's default transform
// ignores in node_modules. We don't need locale negotiation here — we only
// need formatMessage to produce stable English strings the assertions can
// match against.
jest.mock('react-intl', () => {
  const messages: Record<string, string> = {
    'memory.section.title': 'Memory',
    'memory.category.trap': 'Pitfalls',
    'memory.category.decision': 'Decisions',
    'memory.category.convention': 'Conventions',
    'memory.category.procedural': 'Procedures',
    'memory.field.workaround': 'Workaround: {value}',
    'memory.field.why': 'Why: {value}',
    'memory.field.scope': 'Scope: {value}',
    'memory.field.trigger': 'Trigger: {value}',
    'memory.field.alternatives': 'Alternatives considered: {value}',
    'memory.field.implications': 'Implications: {value}',
    'memory.unparseable': '(unparseable memory content)',
  }
  return {
    useIntl: () => ({
      formatMessage: (
        descriptor: { id: string },
        values?: Record<string, string>
      ) => {
        let msg = messages[descriptor.id] ?? descriptor.id
        if (values) {
          for (const [k, v] of Object.entries(values)) {
            msg = msg.replace(`{${k}}`, v)
          }
        }
        return msg
      },
    }),
  }
})

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
    expect(screen.getByText('Pitfalls')).toBeInTheDocument()
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
    // Steps now render as an ordered list, one <li> per step.
    expect(screen.getByText('read schema')).toBeInTheDocument()
    expect(screen.getByText('check enums')).toBeInTheDocument()
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
