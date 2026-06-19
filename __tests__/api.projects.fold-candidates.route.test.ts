/**
 * @jest-environment node
 *
 * LUM-553 — GET fold-candidates: read-only preview, bearer-allowed (unlike the
 * human-only merge/retire actions), workspace-scoped.
 */
import { GET } from '@/app/api/projects/[id]/memories/fold-candidates/route'
import { requireIdentity } from '@/lib/auth'
import { projectRepository } from '@/lib/repositories'
import { computeProjectFoldProposals } from '@/lib/services/memory/fold-compute'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  projectRepository: { findWorkspaceId: jest.fn() },
}))
jest.mock('@/lib/services/memory/fold-compute', () => ({
  computeProjectFoldProposals: jest.fn(),
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFindWs = projectRepository.findWorkspaceId as jest.Mock
const mockCompute = computeProjectFoldProposals as jest.Mock

const req = () => ({ headers: { get: () => null } }) as never
const params = { params: Promise.resolve({ id: 'proj-1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  // A bearer (agent/CLI) identity is allowed here.
  mockIdentity.mockResolvedValue({ workspaceId: 'w-1', source: 'bearer' })
  mockFindWs.mockResolvedValue({ workspaceId: 'w-1' })
  mockCompute.mockResolvedValue({
    proposals: [
      {
        category: 'TRAP',
        coarseContent: { trigger: 't', outcome: 'o' },
        sourceIds: ['a', 'b', 'c'],
        excludedIds: [],
      },
    ],
    degraded: false,
  })
})

describe('fold-candidates GET is read-only bearer-allowed and workspace-scoped', () => {
  it('returns proposals for a bearer caller', async () => {
    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      proposals: [
        {
          category: 'TRAP',
          coarseContent: { trigger: 't', outcome: 'o' },
          sourceIds: ['a', 'b', 'c'],
          excludedIds: [],
        },
      ],
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
