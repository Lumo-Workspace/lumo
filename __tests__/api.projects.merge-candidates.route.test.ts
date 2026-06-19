/**
 * @jest-environment node
 *
 * LUM-541 (P5) — GET near-dup merge candidates for a project's ACTIVE memories.
 * Read path (any workspace member); the proposals are derived, not persisted.
 */
import { GET } from '@/app/api/projects/[id]/memories/merge-candidates/route'
import { requireIdentity } from '@/lib/auth'
import { projectRepository } from '@/lib/repositories'
import { computeProjectMergeProposals } from '@/lib/services/memory/batch-consolidate.service'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  projectRepository: { findWorkspaceId: jest.fn() },
}))
jest.mock('@/lib/services/memory/batch-consolidate.service', () => ({
  computeProjectMergeProposals: jest.fn(),
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFindWs = projectRepository.findWorkspaceId as jest.Mock
const mockCompute = computeProjectMergeProposals as jest.Mock

function req() {
  return { headers: { get: () => null } } as never
}
const params = { params: Promise.resolve({ id: 'proj-1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue({ workspaceId: 'w-1', source: 'clerk' })
  mockFindWs.mockResolvedValue({ workspaceId: 'w-1' })
  mockCompute.mockResolvedValue({
    projectId: 'proj-1',
    nearDupClusterCount: 1,
    mergeProposals: [{ canonicalId: 'keep', supersededIds: ['dup'] }],
  })
})

describe('GET /api/projects/[id]/memories/merge-candidates', () => {
  it('returns the merge proposals and live cluster count for the project', async () => {
    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      candidates: [{ canonicalId: 'keep', supersededIds: ['dup'] }],
      clusterCount: 1,
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
