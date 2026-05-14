/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    session: {
      findUnique: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { sessionRepository } from '@/lib/repositories/session.repository'

const findUnique = prisma.session.findUnique as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('sessionRepository.findTaskBinding', () => {
  it('returns bound:true with identifier and title when session has a task', async () => {
    findUnique.mockResolvedValue({
      task: { number: 12, title: 'Add OAuth', team: { identifier: 'LUM' } },
    })
    const result = await sessionRepository.findTaskBinding('sess_1')
    expect(result).toEqual({
      bound: true,
      taskIdentifier: 'LUM-12',
      taskTitle: 'Add OAuth',
    })
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'sess_1' },
      select: {
        task: {
          select: {
            number: true,
            title: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
  })

  it('returns bound:false when session has no task', async () => {
    findUnique.mockResolvedValue({ task: null })
    const result = await sessionRepository.findTaskBinding('sess_1')
    expect(result).toEqual({ bound: false })
  })

  it('returns bound:false when session does not exist', async () => {
    findUnique.mockResolvedValue(null)
    const result = await sessionRepository.findTaskBinding('sess_1')
    expect(result).toEqual({ bound: false })
  })
})
