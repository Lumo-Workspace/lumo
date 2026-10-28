/**
 * @jest-environment node
 *
 * LUM-1332 — the database ping behind the self-host config check.
 */
const mockFindFirst = jest.fn()
jest.mock('@/lib/db/prisma', () => ({
  prisma: { workspace: { findFirst: (...a: unknown[]) => mockFindFirst(...a) } },
}))

import { selfHostCheckRepository } from '@/lib/repositories/self-host-check.repository'

describe('selfHostCheckRepository.pingDatabase', () => {
  it('reads at most one id, and passes a database error through', async () => {
    mockFindFirst.mockResolvedValueOnce(null)
    await expect(selfHostCheckRepository.pingDatabase()).resolves.toBeUndefined()
    expect(mockFindFirst).toHaveBeenCalledWith({ select: { id: true } })
    mockFindFirst.mockRejectedValueOnce(new Error('relation "workspaces" does not exist'))
    await expect(selfHostCheckRepository.pingDatabase()).rejects.toThrow('workspaces')
  })
})
