const mockFindFirst = jest.fn()
const mockCreate = jest.fn()
const mockUpdate = jest.fn()
const mockDeleteMany = jest.fn()

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    generationJob: {
      findFirst: (...args: any[]) => mockFindFirst(...args),
      create: (...args: any[]) => mockCreate(...args),
      update: (...args: any[]) => mockUpdate(...args),
      deleteMany: (...args: any[]) => mockDeleteMany(...args),
    },
  },
}))

import { generationJobRepository } from '@/lib/repositories/generation-job.repository'

beforeEach(() => jest.clearAllMocks())

describe('generationJobRepository', () => {
  describe('findRecentByTarget', () => {
    it('queries for pending or completed jobs within cooldown window', async () => {
      mockFindFirst.mockResolvedValue(null)

      const result = await generationJobRepository.findRecentByTarget(
        'proj-1',
        5
      )

      expect(result).toBeNull()
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            targetId: 'proj-1',
            status: { in: ['pending', 'completed'] },
          }),
          orderBy: { createdAt: 'desc' },
        })
      )
    })

    it('returns the job when one exists within window', async () => {
      const job = {
        id: 'job-1',
        targetId: 'proj-1',
        status: 'completed',
        createdAt: new Date(),
      }
      mockFindFirst.mockResolvedValue(job)

      const result = await generationJobRepository.findRecentByTarget(
        'proj-1',
        5
      )

      expect(result).toEqual(job)
    })
  })

  describe('create', () => {
    it('creates a new job with pending status', async () => {
      const created = {
        id: 'job-1',
        type: 'project',
        targetId: 'proj-1',
        status: 'pending',
      }
      mockCreate.mockResolvedValue(created)

      const result = await generationJobRepository.create('project', 'proj-1')

      expect(result).toEqual(created)
      expect(mockCreate).toHaveBeenCalledWith({
        data: { type: 'project', targetId: 'proj-1' },
      })
    })
  })

  describe('updateStatus', () => {
    it('updates status and optional summaryId', async () => {
      mockUpdate.mockResolvedValue({ id: 'job-1', status: 'completed' })

      await generationJobRepository.updateStatus('job-1', 'completed', 'sum-1')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { status: 'completed', summaryId: 'sum-1' },
      })
    })
  })

  describe('findById', () => {
    it('returns the job by id', async () => {
      const job = { id: 'job-1', status: 'pending' }
      mockFindFirst.mockResolvedValue(job)

      const result = await generationJobRepository.findById('job-1')

      expect(result).toEqual(job)
    })
  })

  describe('deleteOlderThan', () => {
    it('deletes jobs older than specified days', async () => {
      mockDeleteMany.mockResolvedValue({ count: 5 })

      await generationJobRepository.deleteOlderThan(7)

      expect(mockDeleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: expect.objectContaining({ lt: expect.any(Date) }),
        },
      })
    })
  })

  describe('createSprintPending', () => {
    it('writes a pending sprint job via the default client when no tx is given', async () => {
      mockCreate.mockResolvedValue({
        id: 'job-2',
        type: 'sprint',
        targetId: 'sprint-1',
        status: 'pending',
      })

      await generationJobRepository.createSprintPending('sprint-1')

      expect(mockCreate).toHaveBeenCalledWith({
        data: { type: 'sprint', targetId: 'sprint-1', status: 'pending' },
      })
    })

    it('uses the provided tx client when one is given', async () => {
      const txCreate = jest.fn().mockResolvedValue({ id: 'job-3' })
      const tx = { generationJob: { create: txCreate } } as any

      await generationJobRepository.createSprintPending('sprint-1', tx)

      expect(txCreate).toHaveBeenCalledWith({
        data: { type: 'sprint', targetId: 'sprint-1', status: 'pending' },
      })
      expect(mockCreate).not.toHaveBeenCalled()
    })
  })
})
