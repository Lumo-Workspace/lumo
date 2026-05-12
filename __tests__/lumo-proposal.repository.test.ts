import { lumoProposalRepository } from '@/lib/repositories/lumo-proposal.repository'

const mockCreate = jest.fn()
const mockFindUnique = jest.fn()
const mockFindMany = jest.fn()
const mockUpdate = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    lumoProposal: {
      create: (...a: any[]) => mockCreate(...a),
      findUnique: (...a: any[]) => mockFindUnique(...a),
      findMany: (...a: any[]) => mockFindMany(...a),
      update: (...a: any[]) => mockUpdate(...a),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('lumoProposalRepository', () => {
  it('create stores proposal and returns id', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'prop-1' })

    const result = await lumoProposalRepository.create({
      projectId: 'proj-1',
      taskId: 'task-1',
      operations: [
        {
          type: 'add',
          section: 'Traps',
          content: 'test',
          rationale: 'r',
          sourceTaskId: 'task-1',
        },
      ],
      lumoMdSnapshot: '# LUMO.md',
      summary: 'Added trap',
    })

    expect(result).toEqual({ id: 'prop-1' })
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        projectId: 'proj-1',
        taskId: 'task-1',
        operations: [
          {
            type: 'add',
            section: 'Traps',
            content: 'test',
            rationale: 'r',
            sourceTaskId: 'task-1',
          },
        ],
        lumoMdSnapshot: '# LUMO.md',
        summary: 'Added trap',
      },
      select: { id: true },
    })
  })

  it('findById returns proposal or null', async () => {
    mockFindUnique.mockResolvedValueOnce({ id: 'prop-1', status: 'PENDING' })
    const result = await lumoProposalRepository.findById('prop-1')
    expect(result).toEqual({ id: 'prop-1', status: 'PENDING' })
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'prop-1' },
    })
  })

  it('findByTaskId returns proposals for a task', async () => {
    mockFindMany.mockResolvedValueOnce([{ id: 'prop-1' }])
    const result = await lumoProposalRepository.findByTaskId('task-1')
    expect(result).toEqual([{ id: 'prop-1' }])
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { taskId: 'task-1' },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('updateStatus sets status and optional appliedAt', async () => {
    const now = new Date('2026-05-12')
    mockUpdate.mockResolvedValueOnce({ id: 'prop-1' })
    await lumoProposalRepository.updateStatus('prop-1', 'APPLIED', now)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'prop-1' },
      data: { status: 'APPLIED', appliedAt: now },
      select: { id: true },
    })
  })

  it('updateSyncResult sets status, appliedAt, and prUrl', async () => {
    const now = new Date('2026-05-12')
    mockUpdate.mockResolvedValueOnce({ id: 'prop-1' })
    const result = await lumoProposalRepository.updateSyncResult(
      'prop-1',
      'APPLIED',
      now,
      'https://github.com/org/repo/pull/1'
    )
    expect(result).toEqual({ id: 'prop-1' })
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'prop-1' },
      data: {
        status: 'APPLIED',
        appliedAt: now,
        prUrl: 'https://github.com/org/repo/pull/1',
      },
      select: { id: true },
    })
  })
})
