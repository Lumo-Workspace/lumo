/**
 * @jest-environment node
 *
 * LUM-541 (P5) — the safety crux, mirroring the LUM-540 retire redline. The
 * one-time cleanup is human-only and reversible:
 *  - the merge-confirm route refuses an agent/CLI bearer identity with 403
 *    BEFORE any write (human-only), and
 *  - a confirmed merge archives the superseded duplicates through the existing
 *    status machine (ACTIVE→ARCHIVED, reversible) — never a hard delete.
 */
import { POST } from '@/app/api/projects/[id]/memories/merge/route'
import { requireIdentity } from '@/lib/auth'
import { projectRepository } from '@/lib/repositories'
import { memoryRepository } from '@/lib/repositories/memory.repository'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  projectRepository: { findWorkspaceId: jest.fn() },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    archiveMemoriesInWorkspace: jest.fn(),
    delete: jest.fn(),
  },
}))

const mockIdentity = requireIdentity as jest.Mock
const mockProject = projectRepository.findWorkspaceId as jest.Mock
const mockArchive = memoryRepository.archiveMemoriesInWorkspace as jest.Mock
const mockDelete = memoryRepository.delete as jest.Mock

const CLERK = {
  clerkId: 'clerk-1',
  memberId: 'm-1',
  workspaceId: 'w-1',
  source: 'clerk' as const,
}
const BEARER = { ...CLERK, source: 'bearer' as const }

function req(body: unknown) {
  return {
    headers: { get: () => null },
    json: async () => body,
  } as never
}
const params = { params: Promise.resolve({ id: 'proj1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(CLERK)
  mockProject.mockResolvedValue({ workspaceId: 'w-1' })
  mockArchive.mockResolvedValue({ count: 2 })
})

test('batch merge or retire confirm is human-only and reversible 403 for CLI and no hard delete', async () => {
  const body = { canonicalId: 'keep', supersededIds: ['dup1', 'dup2'] }

  // human-only: an agent/CLI bearer identity is refused before any write
  mockIdentity.mockResolvedValue(BEARER)
  const denied = await POST(req(body), params)
  expect(denied.status).toBe(403)
  expect(mockArchive).not.toHaveBeenCalled()

  // a human (clerk) session confirms the merge: superseded duplicates are
  // ARCHIVED (reversible) within the caller's workspace — never hard-deleted
  mockIdentity.mockResolvedValue(CLERK)
  const ok = await POST(req(body), params)
  expect(ok.status).toBe(200)
  expect(mockArchive).toHaveBeenCalledWith(['dup1', 'dup2'], 'w-1')
  expect(mockDelete).not.toHaveBeenCalled()
})
