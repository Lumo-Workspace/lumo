import { lumoProposalService } from '@/lib/services/lumo-proposal/lumo-proposal.service'

const mockFindForMemoryContext = jest.fn()
const mockFindActiveTaskMemories = jest.fn()
const mockCreateProposal = jest.fn()
const mockCallLLM = jest.fn()

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForMemoryContext: (...a: any[]) => mockFindForMemoryContext(...a),
  },
}))

jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveTaskMemories: (...a: any[]) => mockFindActiveTaskMemories(...a),
  },
}))

jest.mock('@/lib/repositories/lumo-proposal.repository', () => ({
  lumoProposalRepository: {
    create: (...a: any[]) => mockCreateProposal(...a),
  },
}))

jest.mock('@/lib/llm/lumo-proposal-client', () => ({
  callLumoProposalLLM: (...a: any[]) => mockCallLLM(...a),
}))

beforeEach(() => jest.clearAllMocks())

const TASK = {
  id: 'task-1',
  title: 'Fix auth bug',
  description: 'SSO broken',
  projectId: 'proj-1',
  number: 42,
  project: { workspaceId: 'ws-1' },
  team: { identifier: 'LUM' },
}

const MEMORIES = [
  {
    id: 'm1',
    category: 'TRAP',
    content: { summary: 'SSO needs HTTPS' },
    createdAt: new Date(),
  },
]

describe('lumoProposalService.generateProposal', () => {
  it('happy path: reads task + memories → calls LLM → saves proposal', async () => {
    mockFindForMemoryContext.mockResolvedValueOnce(TASK)
    mockFindActiveTaskMemories.mockResolvedValueOnce(MEMORIES)
    mockCallLLM.mockResolvedValueOnce({
      operations: [
        {
          type: 'add',
          section: 'Traps',
          content: 'SSO needs HTTPS',
          rationale: 'r',
          sourceTaskId: 'LUM-42',
        },
      ],
      summary: 'Added SSO trap',
    })
    mockCreateProposal.mockResolvedValueOnce({ id: 'prop-1' })

    const result = await lumoProposalService.generateProposal(
      'task-1',
      '# LUMO.md\n'
    )

    expect(mockFindForMemoryContext).toHaveBeenCalledWith('task-1')
    expect(mockFindActiveTaskMemories).toHaveBeenCalledWith('task-1')
    expect(mockCallLLM).toHaveBeenCalledWith(
      {
        id: 'task-1',
        title: 'Fix auth bug',
        description: 'SSO broken',
        taskIdentifier: 'LUM-42',
      },
      MEMORIES,
      '# LUMO.md\n'
    )
    expect(mockCreateProposal).toHaveBeenCalledWith({
      projectId: 'proj-1',
      taskId: 'task-1',
      operations: [
        {
          type: 'add',
          section: 'Traps',
          content: 'SSO needs HTTPS',
          rationale: 'r',
          sourceTaskId: 'LUM-42',
        },
      ],
      lumoMdSnapshot: '# LUMO.md\n',
      summary: 'Added SSO trap',
    })
    expect(result).toEqual({ id: 'prop-1' })
  })

  it('throws 404 when task not found', async () => {
    mockFindForMemoryContext.mockResolvedValueOnce(null)
    await expect(
      lumoProposalService.generateProposal('missing', '')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 400 when task has no memories', async () => {
    mockFindForMemoryContext.mockResolvedValueOnce(TASK)
    mockFindActiveTaskMemories.mockResolvedValueOnce([])
    await expect(
      lumoProposalService.generateProposal('task-1', '')
    ).rejects.toMatchObject({ status: 400 })
  })
})
