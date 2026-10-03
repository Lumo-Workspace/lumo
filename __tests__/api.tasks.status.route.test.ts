/**
 * @jest-environment node
 */
import { GET } from '@/app/api/tasks/[id]/status/route'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskStatusService } from '@/lib/services/task-status.service'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByIdForMention: jest.fn(),
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/services/task-status.service', () => ({
  ...jest.requireActual('@/lib/services/task-status.service'),
  taskStatusService: { statusForTask: jest.fn() },
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFindByIdentifier =
  taskRepository.findByWorkspaceIdentifier as jest.Mock
const mockFindByCuid = taskRepository.findByIdForMention as jest.Mock
const mockStatus = taskStatusService.statusForTask as jest.Mock

const IDENTITY = {
  clerkId: 'clerk-1',
  memberId: 'member-1',
  workspaceId: 'w-1',
  source: 'bearer' as const,
}

function req() {
  return { headers: { get: () => null } } as never
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(IDENTITY)
  mockFindByIdentifier.mockResolvedValue({ id: 't-1' })
})

const REPORT = {
  version: 2,
  task: { id: 't-1', identifier: 'LUM-42', title: 't', status: 'IN_PROGRESS' },
  struggleTrail: { pullRequests: [], reopens: [] },
  cost: { tokenCost: null, activeTimeSec: 0 },
  trend: { cost: [], rework: { reopens: 0, extraPrCycles: 0, total: 0 } },
  claim: { text: null, source: null },
  faithfulness: { state: 'PENDING' },
  nextActions: [],
  securityFindings: null,
}

describe('GET /api/tasks/[id]/status', () => {
  it('resolves LUM-N in the workspace and returns the read model', async () => {
    mockStatus.mockResolvedValue(REPORT)

    const res = await GET(req(), params('LUM-42'))

    expect(mockFindByIdentifier).toHaveBeenCalledWith('w-1', 'LUM', 42)
    expect(mockStatus).toHaveBeenCalledWith('t-1')
    expect(res.status).toBe(200)
    // LUM-942: v2 report, padded with empty v1 fields so old CLIs still render.
    const body = await res.json()
    expect(body).toMatchObject({ version: 2, task: REPORT.task })
    expect(body).toMatchObject({ criteria: [], verificationHistory: [] })
  })

  it('resolves a raw cuid through the workspace-scoped lookup', async () => {
    const cuid = 'c' + 'a1b2c3d4e5f6a7b8c9d0e1f2'
    mockFindByCuid.mockResolvedValue({ id: cuid })
    mockStatus.mockResolvedValue(REPORT)

    const res = await GET(req(), params(cuid))

    expect(mockFindByCuid).toHaveBeenCalledWith(cuid, 'w-1')
    expect(res.status).toBe(200)
  })

  it('404s when the identifier does not resolve in the workspace', async () => {
    mockFindByIdentifier.mockResolvedValue(null)
    const res = await GET(req(), params('LUM-42'))
    expect(res.status).toBe(404)
    expect(mockStatus).not.toHaveBeenCalled()
  })

  it('short-circuits on an auth failure response', async () => {
    const { NextResponse } = await import('next/server')
    const denied = NextResponse.json({ error: 'nope' }, { status: 401 })
    mockIdentity.mockResolvedValue(denied)
    const res = await GET(req(), params('LUM-42'))
    expect(res.status).toBe(401)
    expect(mockStatus).not.toHaveBeenCalled()
  })
})
