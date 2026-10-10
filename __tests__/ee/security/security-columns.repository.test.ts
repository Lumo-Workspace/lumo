/** @jest-environment node */
// LUM-1065: moved with the queries from projectRepository (RFC §4 option A).
const mockRepo = { findFirst: jest.fn(), updateMany: jest.fn() }
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    projectRepository: {
      findFirst: (...args: unknown[]) => mockRepo.findFirst(...args),
      updateMany: (...args: unknown[]) => mockRepo.updateMany(...args),
    },
  },
}))
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'

beforeEach(() => jest.clearAllMocks())

test('findLastSarifIngestAt distinguishes "no such repo" from "never ingested"', async () => {
  mockRepo.findFirst.mockResolvedValueOnce(null)
  expect(
    await securityColumnsRepository.findLastSarifIngestAt('w1', 'o/r')
  ).toBeUndefined()
  mockRepo.findFirst.mockResolvedValueOnce({ lastSarifIngestAt: null })
  expect(
    await securityColumnsRepository.findLastSarifIngestAt('w1', 'o/r')
  ).toBeNull()
  const at = new Date('2026-09-09T00:00:00Z')
  mockRepo.findFirst.mockResolvedValueOnce({ lastSarifIngestAt: at })
  expect(
    await securityColumnsRepository.findLastSarifIngestAt('w1', 'o/r')
  ).toEqual(at)
  expect(mockRepo.findFirst).toHaveBeenCalledWith({
    where: { fullName: 'o/r', project: { workspaceId: 'w1' } },
    orderBy: { lastSarifIngestAt: { sort: 'desc', nulls: 'last' } },
    select: { lastSarifIngestAt: true },
  })
})

test('markSarifIngested stamps every linked row of that repo in the workspace', async () => {
  mockRepo.updateMany.mockResolvedValueOnce({ count: 2 })
  const at = new Date()
  expect(
    await securityColumnsRepository.markSarifIngested('w1', 'o/r', at)
  ).toBe(2)
  expect(mockRepo.updateMany).toHaveBeenCalledWith({
    where: { fullName: 'o/r', project: { workspaceId: 'w1' } },
    data: { lastSarifIngestAt: at },
  })
})

// ── LUM-738 baseline column ─────────────────────────────────────────────────

const BASELINE = {
  sha: 'b'.repeat(40),
  at: '2026-09-10T00:00:00.000Z',
  requestedAt: '2026-09-10T00:00:00.000Z',
  fingerprints: ['fp-1', 'fp-2'],
  partial: false,
  tools: ['gitleaks', 'semgrep', 'osv-scanner'],
}

test('LUM-738 baseline — findSecurityBaseline distinguishes "no such repo" (undefined) from "never scanned" (null) from a landed baseline', async () => {
  mockRepo.findFirst.mockResolvedValueOnce(null)
  expect(
    await securityColumnsRepository.findSecurityBaseline('w1', 'o/r')
  ).toBeUndefined()
  mockRepo.findFirst.mockResolvedValueOnce({ securityBaseline: null })
  expect(
    await securityColumnsRepository.findSecurityBaseline('w1', 'o/r')
  ).toBeNull()
  mockRepo.findFirst.mockResolvedValueOnce({ securityBaseline: BASELINE })
  expect(
    await securityColumnsRepository.findSecurityBaseline('w1', 'o/r')
  ).toEqual(BASELINE)
  expect(mockRepo.findFirst).toHaveBeenCalledWith({
    where: { fullName: 'o/r', project: { workspaceId: 'w1' } },
    orderBy: { createdAt: 'asc' },
    select: { securityBaseline: true },
  })
})

test('LUM-738 baseline — setSecurityBaseline replaces the JSON on every linked row of that repo in the workspace', async () => {
  mockRepo.updateMany.mockResolvedValueOnce({ count: 2 })
  expect(
    await securityColumnsRepository.setSecurityBaseline('w1', 'o/r', BASELINE)
  ).toBe(2)
  expect(mockRepo.updateMany).toHaveBeenCalledWith({
    where: { fullName: 'o/r', project: { workspaceId: 'w1' } },
    data: { securityBaseline: BASELINE },
  })
})
