/**
 * @jest-environment node
 *
 * LUM-426 — GET open boundary-crossings feeds the Record tab panel. Read
 * path: workspace-scoped, any authenticated identity (reads aren't the redline;
 * the acknowledge POST is the human-only write).
 */
import { GET } from '@/app/api/tasks/[id]/boundary-crossings/route'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByIdForMention: jest.fn(),
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/services/boundary-crossing.service', () => ({
  boundaryCrossingService: { listAll: jest.fn(), isGateEnabled: jest.fn() },
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFind = taskRepository.findByWorkspaceIdentifier as jest.Mock
const mockList = boundaryCrossingService.listAll as jest.Mock
const mockGate = boundaryCrossingService.isGateEnabled as jest.Mock

const IDENTITY = {
  clerkId: 'clerk-1',
  memberId: 'member-1',
  workspaceId: 'w-1',
  source: 'clerk' as const,
}
const params = { params: Promise.resolve({ id: 'LUM-426' }) }

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(IDENTITY)
  mockFind.mockResolvedValue({ id: 't-1' })
  mockList.mockResolvedValue([
    {
      id: 'bc-1',
      category: 'PUSH_TO_PROTECTED_BRANCH',
      detail: 'git push origin main',
      detectedAt: '2026-06-11T00:00:00.000Z',
    },
  ])
  mockGate.mockResolvedValue(true)
})

describe('GET /api/tasks/[id]/boundary-crossings', () => {
  it('returns the open crossings for the resolved task', async () => {
    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      crossings: [
        {
          id: 'bc-1',
          category: 'PUSH_TO_PROTECTED_BRANCH',
          detail: 'git push origin main',
          detectedAt: '2026-06-11T00:00:00.000Z',
        },
      ],
      // LUM-635: the workspace DONE-gate toggle rides along so the panel can
      // compute the blocking subset (opt-out → only HIGH blocks).
      gateEnabled: true,
    })
    expect(mockList).toHaveBeenCalledWith('t-1')
    expect(mockGate).toHaveBeenCalledWith('w-1')
  })

  it('surfaces gateEnabled=false when the workspace opted the gate out', async () => {
    mockGate.mockResolvedValue(false)
    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    expect((await res.json()).gateEnabled).toBe(false)
  })

  it('404 when the task does not resolve in the workspace', async () => {
    mockFind.mockResolvedValue(null)
    const res = await GET(req(), params)
    expect(res.status).toBe(404)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('returns the identity response when auth fails', async () => {
    const { NextResponse } = await import('next/server')
    mockIdentity.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await GET(req(), params)
    expect(res.status).toBe(401)
  })
})

function req() {
  return { headers: { get: () => null } } as never
}
