/**
 * @jest-environment node
 */
const mockRequireIdentity = jest.fn()
jest.mock('@/lib/auth', () => ({
  requireIdentity: (...a: unknown[]) => mockRequireIdentity(...a),
}))
const mockSvc = {
  list: jest.fn(),
  create: jest.fn(),
  getDetail: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  recordRun: jest.fn(),
  resolveCase: jest.fn(),
  authorize: jest.fn(),
}
jest.mock('@/lib/services/milestone-test-case.service', () => ({
  milestoneTestCaseService: new Proxy(
    {},
    { get: (_t, k) => mockSvc[k as keyof typeof mockSvc] }
  ),
}))
const mockStoreEvidence = jest.fn()
jest.mock('@/lib/services/private-file.service', () => ({
  privateFileService: {
    storeMilestoneEvidence: (...a: unknown[]) => mockStoreEvidence(...a),
  },
}))
const mockDisposition = { rule: jest.fn() }
jest.mock('@/lib/services/test-case-defect-disposition.service', () => ({
  testCaseDefectDispositionService: {
    rule: (...a: unknown[]) => mockDisposition.rule(...a),
  },
}))

import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/milestones/[milestoneId]/test-cases/route'
import { POST as RUN } from '@/app/api/milestones/[milestoneId]/test-cases/[caseRef]/runs/route'
import { POST as EVIDENCE } from '@/app/api/milestones/[milestoneId]/test-cases/[caseRef]/evidence/route'
import { POST as DISPOSE } from '@/app/api/milestones/[milestoneId]/test-case-runs/[runId]/disposition/route'

const identity = {
  memberId: 'mem-1',
  workspaceId: 'w-1',
  source: 'bearer',
  clerkId: null,
}
const params = (o: Record<string, string>) =>
  ({ params: Promise.resolve(o) }) as never
const req = (body?: unknown) =>
  new NextRequest('http://x/api', {
    method: body ? 'POST' : 'GET',
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireIdentity.mockResolvedValue(identity)
})

it('lists cases with the gate', async () => {
  mockSvc.list.mockResolvedValue({
    testCases: [],
    gate: { held: 0, cases: [] },
  })
  const res = await GET(req(), params({ milestoneId: 'm-1' }))
  expect(res.status).toBe(200)
  expect(mockSvc.list).toHaveBeenCalledWith('m-1', 'mem-1')
})

it('400s an invalid create body without calling the service', async () => {
  const res = await POST(req({ title: '' }), params({ milestoneId: 'm-1' }))
  expect(res.status).toBe(400)
  expect(mockSvc.create).not.toHaveBeenCalled()
})

it('maps service status errors', async () => {
  mockSvc.list.mockRejectedValue(
    Object.assign(new Error('Milestone not found'), { status: 404 })
  )
  const res = await GET(req(), params({ milestoneId: 'nope' }))
  expect(res.status).toBe(404)
  expect(await res.json()).toEqual({ error: 'Milestone not found' })
})

it('records a run with session provenance', async () => {
  mockSvc.recordRun.mockResolvedValue({
    run: { id: 'r1' },
    ceiling: { effective: 'PASS' },
  })
  const r = new NextRequest('http://x/api', {
    method: 'POST',
    body: JSON.stringify({ result: 'PASS', environment: 'PRODUCTION' }),
    headers: { 'X-Lumo-Session-Id': 'sess-1' },
  })
  const res = await RUN(r, params({ milestoneId: 'm-1', caseRef: 'TC1' }))
  expect(res.status).toBe(200)
  expect(mockSvc.recordRun).toHaveBeenCalledWith(
    'm-1',
    'TC1',
    expect.objectContaining({ result: 'PASS' }),
    { actorMemberId: 'mem-1', sourceSessionId: 'sess-1' }
  )
})

it('hides 500 details', async () => {
  mockSvc.list.mockRejectedValue(new Error('db exploded'))
  const res = await GET(req(), params({ milestoneId: 'm-1' }))
  expect(res.status).toBe(500)
  expect(await res.json()).toEqual({ error: 'Internal error' })
})

describe('evidence upload', () => {
  const multipart = (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return new NextRequest('http://x/api/evidence', {
      method: 'POST',
      body: fd,
    })
  }
  const p = params({ milestoneId: 'm-1', caseRef: 'TC1' })

  it('stores under the milestone and returns { files }', async () => {
    mockSvc.resolveCase.mockResolvedValue({ id: 'tc-1' })
    mockStoreEvidence.mockResolvedValue('http://x/api/files/u')
    const file = new File([new Uint8Array(10)], 'shot.png', {
      type: 'image/png',
    })
    const res = await EVIDENCE(multipart(file), p)
    expect(res.status).toBe(200)
    expect(mockSvc.resolveCase).toHaveBeenCalledWith('m-1', 'TC1', 'mem-1')
    expect(mockStoreEvidence).toHaveBeenCalledWith(
      'm-1',
      'tc-1',
      expect.any(File),
      'http://x'
    )
    expect(await res.json()).toEqual({
      files: [
        {
          url: 'http://x/api/files/u',
          filename: 'shot.png',
          contentType: 'image/png',
          size: 10,
        },
      ],
    })
  })

  it('400s an unsupported content type without storing', async () => {
    mockSvc.resolveCase.mockResolvedValue({ id: 'tc-1' })
    const file = new File([new Uint8Array(4)], 'a.pdf', {
      type: 'application/pdf',
    })
    const res = await EVIDENCE(multipart(file), p)
    expect(res.status).toBe(400)
    expect(mockStoreEvidence).not.toHaveBeenCalled()
  })
})

describe('disposition', () => {
  it('bearer identity rules with channel CLI and a milestone owner', async () => {
    mockDisposition.rule.mockResolvedValue({ id: 'd-1' })
    const res = await DISPOSE(
      req({ disposition: 'KNOWN_DEFECT', receipt: 'r2.a.b.c.sig' }),
      params({ milestoneId: 'm-1', runId: 'run-1' })
    )
    expect(res.status).toBe(201)
    expect(mockSvc.authorize).toHaveBeenCalledWith('m-1', 'mem-1')
    expect(mockDisposition.rule).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: { kind: 'milestone', milestoneId: 'm-1' },
        runId: 'run-1',
        ruling: 'KNOWN_DEFECT',
        channel: 'CLI',
      })
    )
  })
})
