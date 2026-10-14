/** @jest-environment node */
import { GET } from '@/app/api/tasks/[id]/security-scans/route'
import { POST } from '@/app/api/tasks/[id]/security-findings/[findingId]/disposition/route'
import { GET as LIST } from '@/app/api/tasks/[id]/security-findings/route'
import {
  requireAuth,
  requireWorkspaceMember,
  requireIdentity,
} from '@/lib/auth'
import { taskService } from '@/lib/services'
import { taskRepository } from '@/lib/repositories'
import { prSecurityScanService } from '@/ee/security/services/pr-security-scan.service'

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
  requireWorkspaceMember: jest.fn(),
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/services', () => ({
  taskService: { getTaskDetail: jest.fn() },
}))
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByIdForMention: jest.fn(),
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/pr-security-scan.service', () => ({
  prSecurityScanService: {
    getForTask: jest.fn(),
    disposition: jest.fn(),
    listFindingsForTask: jest.fn(),
  },
}))

const auth = requireAuth as jest.Mock
const member = requireWorkspaceMember as jest.Mock
const identity = requireIdentity as jest.Mock
const detail = taskService.getTaskDetail as jest.Mock
const byIdentifier = taskRepository.findByWorkspaceIdentifier as jest.Mock
const getForTask = prSecurityScanService.getForTask as jest.Mock
const disposition = prSecurityScanService.disposition as jest.Mock
const listFindings = prSecurityScanService.listFindingsForTask as jest.Mock

const CLERK = {
  clerkId: 'c1',
  memberId: 'm1',
  workspaceId: 'w1',
  source: 'clerk' as const,
}

function req(body?: unknown, hdrs: Record<string, string> = {}) {
  return {
    json: async () => body,
    headers: { get: (k: string) => hdrs[k] ?? null },
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  auth.mockResolvedValue({ userId: 'c1' })
  member.mockResolvedValue({ id: 'm1' })
  detail.mockResolvedValue({ id: 't1', project: { workspaceId: 'w1' } })
  identity.mockResolvedValue(CLERK)
  byIdentifier.mockResolvedValue({ id: 't1' })
  getForTask.mockResolvedValue({ prs: [], blocking: { count: 0 } })
  disposition.mockResolvedValue({ id: 'f1', disposition: 'FALSE_POSITIVE' })
})

describe('GET /api/tasks/[id]/security-scans', () => {
  it('returns the read model for a workspace member and 404 for a missing task', async () => {
    const res = await GET(req(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ prs: [], blocking: { count: 0 } })
    expect(getForTask).toHaveBeenCalledWith('t1')

    detail.mockResolvedValue(null)
    const missing = await GET(req(), {
      params: Promise.resolve({ id: 'nope' }),
    })
    expect(missing.status).toBe(404)
  })
})

describe('POST /api/tasks/[id]/security-findings/[findingId]/disposition', () => {
  const params = { params: Promise.resolve({ id: 'LUM-732', findingId: 'f1' }) }

  it('LUM-1128: a bearer (CLI) identity rules through the same route, recorded as channel CLI with its session', async () => {
    identity.mockResolvedValue({ ...CLERK, clerkId: null, source: 'bearer' })
    const res = await POST(
      req(
        { disposition: 'ACCEPTED_RISK', note: 'user approved in chat' },
        { 'X-Lumo-Session-Id': 'sess-1' }
      ),
      params
    )
    expect(res.status).toBe(200)
    expect((await res.json()).channel).toBe('CLI')
    expect(disposition).toHaveBeenCalledWith(
      't1',
      'f1',
      'ACCEPTED_RISK',
      'user approved in chat',
      'm1',
      {
        workspaceId: 'w1',
        context: expect.objectContaining({ source: 'CLI' }),
      },
      { channel: 'CLI', sessionId: 'sess-1' }
    )
  })

  it('LUM-1128: no agent-session guard — a bearer call is never refused for who it is', async () => {
    identity.mockResolvedValue({ ...CLERK, clerkId: null, source: 'bearer' })
    const res = await POST(
      req({ disposition: 'FALSE_POSITIVE' }, { 'X-Lumo-Session-Id': 'agent' }),
      params
    )
    expect(res.status).not.toBe(403)
    expect(disposition).toHaveBeenCalledTimes(1)
  })

  it('LUM-1128: a task outside the caller workspace is a 404 and nothing is written', async () => {
    identity.mockResolvedValue({
      ...CLERK,
      clerkId: null,
      workspaceId: 'w-other',
      source: 'bearer',
    })
    byIdentifier.mockResolvedValue(null)
    const res = await POST(req({ disposition: 'FALSE_POSITIVE' }), params)
    expect(res.status).toBe(404)
    expect(byIdentifier).toHaveBeenCalledWith('w-other', 'LUM', 732)
    expect(disposition).not.toHaveBeenCalled()
  })

  it('records a human disposition with the member id and rejects bad bodies', async () => {
    const res = await POST(
      req({ disposition: 'FALSE_POSITIVE', note: 'doc key' }),
      params
    )
    expect(res.status).toBe(200)
    expect(disposition).toHaveBeenCalledWith(
      't1',
      'f1',
      'FALSE_POSITIVE',
      'doc key',
      'm1',
      {
        workspaceId: 'w1',
        context: expect.objectContaining({ source: 'WEB' }),
      },
      { channel: 'WEB', sessionId: null }
    )

    const bad = await POST(req({ disposition: 'CONFIRMED' }), params)
    expect(bad.status).toBe(400)

    disposition.mockRejectedValue(
      Object.assign(new Error('Security finding not found on this task'), {
        status: 404,
      })
    )
    const missing = await POST(req({ disposition: 'ACCEPTED_RISK' }), params)
    expect(missing.status).toBe(404)
  })
})

describe('GET /api/tasks/[id]/security-findings (LUM-1128)', () => {
  const params = { params: Promise.resolve({ id: 'LUM-732' }) }

  it('lists the flat CLI rows for a bearer caller in its own workspace', async () => {
    identity.mockResolvedValue({ ...CLERK, clerkId: null, source: 'bearer' })
    listFindings.mockResolvedValue([{ id: 'f1', blocking: true }])
    const res = await LIST(req(), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      findings: [{ id: 'f1', blocking: true }],
    })
    expect(listFindings).toHaveBeenCalledWith('t1')
  })

  it('is a 404 for a task in another workspace', async () => {
    byIdentifier.mockResolvedValue(null)
    const res = await LIST(req(), params)
    expect(res.status).toBe(404)
    expect(listFindings).not.toHaveBeenCalled()
  })
})
