/** @jest-environment node */
import { GET } from '@/app/api/tasks/[id]/security-scans/route'
import { POST } from '@/app/api/tasks/[id]/security-findings/[findingId]/disposition/route'
import { GET as LIST } from '@/app/api/tasks/[id]/security-findings/route'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { prSecurityScanService } from '@/ee/security/services/pr-security-scan.service'
import { prScanReadoutService } from '@/ee/security/services/pr-scan-readout.service'

jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByIdForMention: jest.fn(),
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/pr-scan-readout.service', () => ({
  prScanReadoutService: { getForTask: jest.fn() },
}))
jest.mock('@/ee/security/services/pr-security-scan.service', () => ({
  prSecurityScanService: {
    getForTask: jest.fn(),
    disposition: jest.fn(),
    listFindingsForTask: jest.fn(),
  },
}))

const identity = requireIdentity as jest.Mock
const byIdentifier = taskRepository.findByWorkspaceIdentifier as jest.Mock
const getForTask = prSecurityScanService.getForTask as jest.Mock
const disposition = prSecurityScanService.disposition as jest.Mock
const listFindings = prSecurityScanService.listFindingsForTask as jest.Mock
const readoutForTask = prScanReadoutService.getForTask as jest.Mock
const byCuid = taskRepository.findByIdForMention as jest.Mock

const CLERK = {
  clerkId: 'c1',
  memberId: 'm1',
  workspaceId: 'w1',
  source: 'clerk' as const,
}

function req(
  body?: unknown,
  hdrs: Record<string, string> = {},
  url = 'https://lumo.test/api/tasks/x'
) {
  return {
    url,
    json: async () => body,
    headers: { get: (k: string) => hdrs[k] ?? null },
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  identity.mockResolvedValue(CLERK)
  byIdentifier.mockResolvedValue({
    id: 't1',
    number: 732,
    team: { identifier: 'LUM' },
  })
  byCuid.mockResolvedValue(null)
  readoutForTask.mockResolvedValue({ version: 1, pullRequests: [] })
  getForTask.mockResolvedValue({ prs: [], blocking: { count: 0 } })
  disposition.mockResolvedValue({ id: 'f1', disposition: 'FALSE_POSITIVE' })
})

describe('GET /api/tasks/[id]/security-scans', () => {
  const CUID = 'c' + 'a'.repeat(24)
  const BEARER = { ...CLERK, clerkId: null, source: 'bearer' as const }

  it('a browser session gets the panel read model, resolved in its workspace by cuid (web unchanged)', async () => {
    byCuid.mockResolvedValue({
      id: CUID,
      number: 732,
      team: { identifier: 'LUM' },
    })
    const res = await GET(req(), { params: Promise.resolve({ id: CUID }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ prs: [], blocking: { count: 0 } })
    expect(byCuid).toHaveBeenCalledWith(CUID, 'w1')
    expect(getForTask).toHaveBeenCalledWith(CUID)
    expect(readoutForTask).not.toHaveBeenCalled()
  })

  it('LUM-1189: a bearer (CLI) caller gets the sanitized read-out, never the panel model', async () => {
    identity.mockResolvedValue(BEARER)
    const res = await GET(req(), {
      params: Promise.resolve({ id: 'LUM-732' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ version: 1, pullRequests: [] })
    expect(byIdentifier).toHaveBeenCalledWith('w1', 'LUM', 732)
    expect(readoutForTask).toHaveBeenCalledWith(
      'w1',
      { id: 't1', identifier: 'LUM-732' },
      { all: false }
    )
    expect(getForTask).not.toHaveBeenCalled()
  })

  it('LUM-1189: ?view=readout&all=1 serves the read-out with every head', async () => {
    const res = await GET(
      req(undefined, {}, 'https://lumo.test/api/tasks/x?view=readout&all=1'),
      { params: Promise.resolve({ id: 'LUM-732' }) }
    )
    expect(res.status).toBe(200)
    expect(readoutForTask).toHaveBeenCalledWith(
      'w1',
      { id: 't1', identifier: 'LUM-732' },
      { all: true }
    )
  })

  it('LUM-1189: a task in another workspace is a 404 for a bearer caller and nothing is read', async () => {
    identity.mockResolvedValue({ ...BEARER, workspaceId: 'w-other' })
    byIdentifier.mockResolvedValue(null)
    const res = await GET(req(), {
      params: Promise.resolve({ id: 'LUM-732' }),
    })
    expect(res.status).toBe(404)
    expect(byIdentifier).toHaveBeenCalledWith('w-other', 'LUM', 732)
    expect(readoutForTask).not.toHaveBeenCalled()
    expect(getForTask).not.toHaveBeenCalled()
  })

  it("LUM-1189: another workspace's task by raw cuid is a 404 too", async () => {
    identity.mockResolvedValue({ ...BEARER, workspaceId: 'w-other' })
    const res = await GET(req(), { params: Promise.resolve({ id: CUID }) })
    expect(res.status).toBe(404)
    expect(byCuid).toHaveBeenCalledWith(CUID, 'w-other')
    expect(readoutForTask).not.toHaveBeenCalled()
  })

  it('rejects an unknown view, passes the identity failure through, and 500s on a read error', async () => {
    const bad = await GET(
      req(undefined, {}, 'https://lumo.test/api/tasks/x?view=raw'),
      { params: Promise.resolve({ id: 'LUM-732' }) }
    )
    expect(bad.status).toBe(400)

    const { NextResponse } = await import('next/server')
    identity.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const unauth = await GET(req(), {
      params: Promise.resolve({ id: 'LUM-732' }),
    })
    expect(unauth.status).toBe(401)

    identity.mockResolvedValue(BEARER)
    readoutForTask.mockRejectedValue(new Error('db down'))
    const boom = await GET(req(), {
      params: Promise.resolve({ id: 'LUM-732' }),
    })
    expect(boom.status).toBe(500)
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
