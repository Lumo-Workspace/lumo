/**
 * @jest-environment node
 *
 * LUM-540 (P4a) — GET retire candidates for a project's ACTIVE memories. Read
 * path (any workspace member); the candidate list is derived, not persisted.
 */
import { GET } from '@/app/api/projects/[id]/memories/retire-candidates/route'
import { requireIdentity } from '@/lib/auth'
import { projectRepository } from '@/lib/repositories'
import { computeProjectRetireCandidates } from '@/lib/services/memory/retire.service'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  projectRepository: { findWorkspaceId: jest.fn() },
}))
jest.mock('@/lib/services/memory/retire.service', () => ({
  computeProjectRetireCandidates: jest.fn(),
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFindWs = projectRepository.findWorkspaceId as jest.Mock
const mockCompute = computeProjectRetireCandidates as jest.Mock

function req() {
  return { headers: { get: () => null } } as never
}
const params = { params: Promise.resolve({ id: 'proj-1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue({ workspaceId: 'w-1', source: 'clerk' })
  mockFindWs.mockResolvedValue({ workspaceId: 'w-1' })
  mockCompute.mockResolvedValue([
    { memoryId: 'low', reasons: ['low-judged-used'] },
  ])
})

describe('GET /api/projects/[id]/memories/retire-candidates', () => {
  it('returns the computed candidates for the project', async () => {
    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      candidates: [{ memoryId: 'low', reasons: ['low-judged-used'] }],
    })
    expect(mockCompute).toHaveBeenCalledWith('proj-1')
  })

  it('refuses a cross-workspace project with 403', async () => {
    mockFindWs.mockResolvedValue({ workspaceId: 'other-ws' })
    const res = await GET(req(), params)
    expect(res.status).toBe(403)
    expect(mockCompute).not.toHaveBeenCalled()
  })
})
