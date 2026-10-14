/**
 * @jest-environment node
 *
 * LUM-1135: the milestone test-case detail route (GET / PATCH / DELETE) and the
 * disposition read-receipt route delegate with the right arguments; the WEB
 * channel branch of the disposition route.
 */
const mockRequireIdentity = jest.fn()
jest.mock('@/lib/auth', () => ({
  requireIdentity: (...a: unknown[]) => mockRequireIdentity(...a),
}))
const mockSvc = {
  getDetail: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  authorize: jest.fn(),
}
jest.mock('@/lib/services/milestone-test-case.service', () => ({
  milestoneTestCaseService: new Proxy(
    {},
    { get: (_t, k) => mockSvc[k as keyof typeof mockSvc] }
  ),
}))
const mockDisp = {
  rule: jest.fn(),
  issueReadReceipt: jest.fn(),
  acknowledgeReadReceipt: jest.fn(),
  describe: jest.fn(),
}
jest.mock('@/lib/services/test-case-defect-disposition.service', () => ({
  testCaseDefectDispositionService: new Proxy(
    {},
    { get: (_t, k) => mockDisp[k as keyof typeof mockDisp] }
  ),
}))

import { NextRequest } from 'next/server'
import {
  DELETE,
  GET,
  PATCH,
} from '@/app/api/milestones/[milestoneId]/test-cases/[caseRef]/route'
import { POST as RECEIPT } from '@/app/api/milestones/[milestoneId]/test-case-runs/[runId]/disposition/receipt/route'
import { POST as DISPOSE } from '@/app/api/milestones/[milestoneId]/test-case-runs/[runId]/disposition/route'

const bearer = {
  memberId: 'mem-1',
  workspaceId: 'w-1',
  source: 'bearer',
  clerkId: null,
}
const clerk = { ...bearer, source: 'clerk', clerkId: 'user_1' }
const params = (o: Record<string, string>) =>
  ({ params: Promise.resolve(o) }) as never
const req = (
  method: string,
  body?: unknown,
  headers?: Record<string, string>
) =>
  new NextRequest('http://x/api', {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(headers ? { headers } : {}),
  })
const caseParams = params({ milestoneId: 'm-1', caseRef: 'TC2' })
const runParams = () => params({ milestoneId: 'm-1', runId: 'run-1' })

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireIdentity.mockResolvedValue(bearer)
})

describe('test-cases/[caseRef]', () => {
  it('GET delegates to getDetail(milestoneId, caseRef, memberId)', async () => {
    mockSvc.getDetail.mockResolvedValue({
      testCase: { id: 'tc' },
      runs: [],
      pullRequests: [],
    })
    const res = await GET(req('GET'), caseParams)
    expect(res.status).toBe(200)
    expect(mockSvc.getDetail).toHaveBeenCalledWith('m-1', 'TC2', 'mem-1')
    expect(await res.json()).toMatchObject({ pullRequests: [] })
  })

  it('PATCH validates, then delegates with attribution', async () => {
    mockSvc.update.mockResolvedValue({ testCase: { id: 'tc' } })
    const res = await PATCH(
      req('PATCH', { title: 'Renamed' }, { 'X-Lumo-Session-Id': 'sess-1' }),
      caseParams
    )
    expect(res.status).toBe(200)
    expect(mockSvc.update).toHaveBeenCalledWith(
      'm-1',
      'TC2',
      expect.objectContaining({ title: 'Renamed' }),
      { actorMemberId: 'mem-1', sourceSessionId: 'sess-1' }
    )
  })

  it('PATCH 400s an invalid body without calling the service', async () => {
    const res = await PATCH(req('PATCH', { title: '' }), caseParams)
    expect(res.status).toBe(400)
    expect(mockSvc.update).not.toHaveBeenCalled()
  })

  it('DELETE delegates with attribution and maps a 409 lock', async () => {
    mockSvc.remove.mockResolvedValue(undefined)
    const ok = await DELETE(req('DELETE'), caseParams)
    expect(ok.status).toBe(200)
    expect(mockSvc.remove).toHaveBeenCalledWith('m-1', 'TC2', {
      actorMemberId: 'mem-1',
      sourceSessionId: null,
    })
    mockSvc.remove.mockRejectedValue(
      Object.assign(new Error('Milestone is completed'), { status: 409 })
    )
    expect((await DELETE(req('DELETE'), caseParams)).status).toBe(409)
  })
})

describe('disposition/receipt', () => {
  it('403s a non-bearer (web) caller before any service call', async () => {
    mockRequireIdentity.mockResolvedValue(clerk)
    const res = await RECEIPT(
      req('POST', { disposition: 'KNOWN_DEFECT' }),
      runParams()
    )
    expect(res.status).toBe(403)
    expect(mockSvc.authorize).not.toHaveBeenCalled()
    expect(mockDisp.issueReadReceipt).not.toHaveBeenCalled()
  })

  it('stage 1 issues a receipt against the milestone owner', async () => {
    mockDisp.issueReadReceipt.mockResolvedValue({ receipt: 'r1.x' })
    mockDisp.describe.mockResolvedValue({ caseNumber: 1 })
    const res = await RECEIPT(
      req(
        'POST',
        { disposition: 'NOT_A_DEFECT' },
        { 'X-Lumo-Session-Id': 'sess-1' }
      ),
      runParams()
    )
    expect(res.status).toBe(200)
    expect(mockSvc.authorize).toHaveBeenCalledWith('m-1', 'mem-1')
    expect(mockDisp.issueReadReceipt).toHaveBeenCalledWith(
      { kind: 'milestone', milestoneId: 'm-1' },
      'run-1',
      'NOT_A_DEFECT',
      { sessionId: 'sess-1', memberId: 'mem-1' }
    )
    expect(mockDisp.acknowledgeReadReceipt).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({
      receipt: 'r1.x',
      subject: { caseNumber: 1 },
    })
  })

  it('stage 2 acknowledges the stage-1 receipt', async () => {
    mockDisp.acknowledgeReadReceipt.mockResolvedValue({ receipt: 'r2.x' })
    mockDisp.describe.mockResolvedValue({})
    const res = await RECEIPT(
      req('POST', { disposition: 'KNOWN_DEFECT', acknowledge: 'r1.x' }),
      runParams()
    )
    expect(res.status).toBe(200)
    expect(mockDisp.acknowledgeReadReceipt).toHaveBeenCalledWith(
      { kind: 'milestone', milestoneId: 'm-1' },
      'run-1',
      'KNOWN_DEFECT',
      'r1.x',
      { sessionId: null, memberId: 'mem-1' }
    )
  })
})

describe('disposition (web)', () => {
  it('a Clerk identity rules with channel WEB and no receipt', async () => {
    mockRequireIdentity.mockResolvedValue(clerk)
    mockDisp.rule.mockResolvedValue({ id: 'd-1' })
    const res = await DISPOSE(
      req('POST', { disposition: 'KNOWN_DEFECT' }),
      runParams()
    )
    expect(res.status).toBe(201)
    expect(mockDisp.rule).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: { kind: 'milestone', milestoneId: 'm-1' },
        runId: 'run-1',
        ruling: 'KNOWN_DEFECT',
        channel: 'WEB',
      })
    )
  })
})
