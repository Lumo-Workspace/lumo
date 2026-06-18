/**
 * @jest-environment node
 *
 * LUM-540 (P4a) criterion — the safety crux. Confirming a memory retirement is a
 * human-only write path (mirrors the LUM-435 boundary-disposition redline): an
 * agent/CLI bearer identity is refused 403 BEFORE anything is written, so an
 * agent can never retire a memory without a human at the web UI. On a Clerk
 * (human) session it retires through the existing status machine (archiveMemories
 * — never a hard delete).
 */
import { POST } from '@/app/api/memories/[memoryId]/retire/route'
import { requireIdentity } from '@/lib/auth'
import { memoryRepository } from '@/lib/repositories'
import { retireConfirmed } from '@/lib/services/memory/retire.service'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  memoryRepository: { findByIdWithWorkspace: jest.fn() },
}))
jest.mock('@/lib/services/memory/retire.service', () => ({
  retireConfirmed: jest.fn(),
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFind = memoryRepository.findByIdWithWorkspace as jest.Mock
const mockRetire = retireConfirmed as jest.Mock

const CLERK = {
  clerkId: 'clerk-1',
  memberId: 'm-1',
  workspaceId: 'w-1',
  source: 'clerk' as const,
}
const BEARER = { ...CLERK, source: 'bearer' as const }

function req() {
  return { headers: { get: () => null } } as never
}
const params = { params: Promise.resolve({ memoryId: 'mem-1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(CLERK)
  mockFind.mockResolvedValue({ id: 'mem-1', workspaceId: 'w-1' })
  mockRetire.mockResolvedValue(1)
})

describe('POST /api/memories/[memoryId]/retire', () => {
  it('agent/CLI bearer identity is refused 403 and nothing is retired', async () => {
    mockIdentity.mockResolvedValue(BEARER)
    const res = await POST(req(), params)
    expect(res.status).toBe(403)
    expect(mockRetire).not.toHaveBeenCalled()
  })

  it('a human (clerk) session retires the memory through the status machine', async () => {
    const res = await POST(req(), params)
    expect(res.status).toBe(200)
    expect(mockRetire).toHaveBeenCalledWith('mem-1')
  })

  it('cross-workspace memory is refused 403 without retiring', async () => {
    mockFind.mockResolvedValue({ id: 'mem-1', workspaceId: 'other-ws' })
    const res = await POST(req(), params)
    expect(res.status).toBe(403)
    expect(mockRetire).not.toHaveBeenCalled()
  })
})
