/** @jest-environment node */
const mockRepo = { findFirst: jest.fn(), updateMany: jest.fn() }
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    projectRepository: {
      findFirst: (...args: unknown[]) => mockRepo.findFirst(...args),
      updateMany: (...args: unknown[]) => mockRepo.updateMany(...args),
    },
  },
}))
import { projectRepository } from '@/lib/repositories/project.repository'

beforeEach(() => jest.clearAllMocks())

test('findLastSarifIngestAt distinguishes "no such repo" from "never ingested"', async () => {
  mockRepo.findFirst.mockResolvedValueOnce(null)
  expect(
    await projectRepository.findLastSarifIngestAt('w1', 'o/r')
  ).toBeUndefined()
  mockRepo.findFirst.mockResolvedValueOnce({ lastSarifIngestAt: null })
  expect(await projectRepository.findLastSarifIngestAt('w1', 'o/r')).toBeNull()
  const at = new Date('2026-09-09T00:00:00Z')
  mockRepo.findFirst.mockResolvedValueOnce({ lastSarifIngestAt: at })
  expect(await projectRepository.findLastSarifIngestAt('w1', 'o/r')).toEqual(at)
  expect(mockRepo.findFirst).toHaveBeenCalledWith({
    where: { fullName: 'o/r', project: { workspaceId: 'w1' } },
    orderBy: { lastSarifIngestAt: { sort: 'desc', nulls: 'last' } },
    select: { lastSarifIngestAt: true },
  })
})

test('markSarifIngested stamps every linked row of that repo in the workspace', async () => {
  mockRepo.updateMany.mockResolvedValueOnce({ count: 2 })
  const at = new Date()
  expect(await projectRepository.markSarifIngested('w1', 'o/r', at)).toBe(2)
  expect(mockRepo.updateMany).toHaveBeenCalledWith({
    where: { fullName: 'o/r', project: { workspaceId: 'w1' } },
    data: { lastSarifIngestAt: at },
  })
})
