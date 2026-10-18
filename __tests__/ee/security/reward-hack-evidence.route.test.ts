/**
 * @jest-environment node
 *
 * LUM-1234 Task 11 — GET .../security-findings/[findingId]/reward-hack-evidence:
 * browser session only, task resolved in the caller's workspace, and every
 * "no view" from the service is a 404.
 */
import { GET } from '@/app/api/tasks/[id]/security-findings/[findingId]/reward-hack-evidence/route'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { rewardHackEvidenceService } from '@/ee/security/services/reward-hack-evidence.service'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByIdForMention: jest.fn(),
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/reward-hack-evidence.service', () => ({
  rewardHackEvidenceService: { getForViewer: jest.fn() },
}))

const identity = requireIdentity as jest.Mock
const byIdentifier = taskRepository.findByWorkspaceIdentifier as jest.Mock
const getForViewer = rewardHackEvidenceService.getForViewer as jest.Mock

const CLERK = {
  clerkId: 'c1',
  memberId: 'm1',
  workspaceId: 'w1',
  source: 'clerk' as const,
}
const req = {
  url: 'https://lumo.test/x',
  headers: { get: () => null },
} as never
const params = (id = 'LUM-1', findingId = 'f1') => ({
  params: Promise.resolve({ id, findingId }),
})

beforeEach(() => {
  jest.clearAllMocks()
  identity.mockResolvedValue(CLERK)
  byIdentifier.mockResolvedValue({
    id: 't1',
    number: 1,
    status: 'IN_PROGRESS',
    workStartedAt: null,
    team: { identifier: 'LUM' },
  })
})

describe('GET reward-hack-evidence', () => {
  it('returns the view for the resolved task, uncached', async () => {
    const view = {
      summary: 's',
      requirementExcerpt: '',
      steps: [],
      prompts: [],
      restricted: true,
    }
    getForViewer.mockResolvedValue(view)
    const res = await GET(req, params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(view)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(getForViewer).toHaveBeenCalledWith('f1', 'c1', { taskId: 't1' })
  })

  it('refuses an API-key caller: session text never reaches a terminal', async () => {
    identity.mockResolvedValue({ ...CLERK, source: 'bearer' })
    const res = await GET(req, params())
    expect(res.status).toBe(403)
    expect(getForViewer).not.toHaveBeenCalled()
  })

  it('404s when the service has no view (non-member, wrong kind, other task)', async () => {
    getForViewer.mockResolvedValue(null)
    expect((await GET(req, params())).status).toBe(404)
  })

  it('404s for a task outside the caller workspace', async () => {
    byIdentifier.mockResolvedValue(null)
    expect((await GET(req, params())).status).toBe(404)
    expect(getForViewer).not.toHaveBeenCalled()
  })

  it('400s on an empty finding id', async () => {
    expect((await GET(req, params('LUM-1', ' '))).status).toBe(400)
  })
})
