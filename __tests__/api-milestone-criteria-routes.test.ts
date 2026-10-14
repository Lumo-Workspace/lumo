/**
 * @jest-environment node
 *
 * LUM-643: the milestone exit-criteria route handlers themselves — thin
 * wrappers, tested as such: auth passthrough, zod 400s, service delegation
 * with session-header attribution, and error-status mapping.
 */
jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/services/milestone-exit-criteria.service', () => ({
  milestoneExitCriteriaService: {
    listForMilestone: jest.fn(),
    setCriteria: jest.fn(),
    adjudicate: jest.fn(),
  },
}))

import { NextRequest } from 'next/server'
import { GET, PUT } from '@/app/api/milestones/[milestoneId]/criteria/route'
import { POST } from '@/app/api/milestones/[milestoneId]/criteria/[criterionId]/verdict/route'
import { requireIdentity } from '@/lib/auth'
import { milestoneExitCriteriaService } from '@/lib/services/milestone-exit-criteria.service'

const mockIdentity = requireIdentity as jest.Mock
const mockList = milestoneExitCriteriaService.listForMilestone as jest.Mock
const mockSet = milestoneExitCriteriaService.setCriteria as jest.Mock
const mockAdjudicate = milestoneExitCriteriaService.adjudicate as jest.Mock

const criteriaParams = { params: Promise.resolve({ milestoneId: 'm-1' }) }
const verdictParams = {
  params: Promise.resolve({ milestoneId: 'm-1', criterionId: 'c-1' }),
}

function jsonRequest(
  url: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue({ memberId: 'mem-1', source: 'bearer' })
})

describe('GET /api/milestones/[id]/criteria', () => {
  it('returns the contract from the service', async () => {
    mockList.mockResolvedValue({
      criteria: [{ id: 'c-1' }],
      unresolvedCount: 1,
    })
    const res = await GET(new NextRequest('http://x/c'), criteriaParams)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      criteria: [{ id: 'c-1' }],
      unresolvedCount: 1,
    })
    expect(mockList).toHaveBeenCalledWith('m-1', 'mem-1')
  })

  it('maps a service 404 to the response status', async () => {
    mockList.mockRejectedValue(
      Object.assign(new Error('Milestone not found'), { status: 404 })
    )
    const res = await GET(new NextRequest('http://x/c'), criteriaParams)
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/milestones/[id]/criteria', () => {
  it('validates the body and delegates with session attribution', async () => {
    mockSet.mockResolvedValue({ criteria: [] })
    const res = await PUT(
      jsonRequest(
        'http://x/c',
        'PUT',
        {
          source: 'AGENT_DRAFT',
          criteria: [{ statement: 's', referentKind: 'EXTERNAL_FACT' }],
        },
        { 'X-Lumo-Session-Id': 'cc-1' }
      ),
      criteriaParams
    )
    expect(res.status).toBe(200)
    expect(mockSet).toHaveBeenCalledWith(
      'm-1',
      {
        source: 'AGENT_DRAFT',
        criteria: [{ statement: 's', referentKind: 'EXTERNAL_FACT' }],
      },
      { actorMemberId: 'mem-1', sourceSessionId: 'cc-1' }
    )
  })

  it('rejects a malformed body with 400 before the service is touched', async () => {
    const res = await PUT(
      jsonRequest('http://x/c', 'PUT', {
        criteria: [{ statement: 's', referentKind: 'NOT_A_KIND' }],
      }),
      criteriaParams
    )
    expect(res.status).toBe(400)
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('maps the COMPLETED contract-lock 409 through', async () => {
    mockSet.mockRejectedValue(
      Object.assign(new Error('contract is locked'), { status: 409 })
    )
    const res = await PUT(
      jsonRequest('http://x/c', 'PUT', { criteria: [] }),
      criteriaParams
    )
    expect(res.status).toBe(409)
  })
})

describe('PUT deprecation (LUM-1135)', () => {
  it('410s a new contract on a milestone with no criteria', async () => {
    mockSet.mockRejectedValue(
      Object.assign(new Error('Exit criteria are deprecated'), { status: 410 })
    )
    const res = await PUT(
      jsonRequest('http://x/c', 'PUT', {
        criteria: [{ statement: 's', referentKind: 'EXTERNAL_FACT' }],
      }),
      criteriaParams
    )
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ error: 'Exit criteria are deprecated' })
  })
})

describe('POST /api/milestones/[id]/criteria/[cid]/verdict', () => {
  it('validates the verdict body and delegates with session attribution', async () => {
    mockAdjudicate.mockResolvedValue({
      criterion: { id: 'c-1', verdict: 'MET' },
    })
    const res = await POST(
      jsonRequest(
        'http://x/v',
        'POST',
        { verdict: 'MET', evidence: 'run 812' },
        { 'X-Lumo-Session-Id': 'cc-1' }
      ),
      verdictParams
    )
    expect(res.status).toBe(200)
    expect(mockAdjudicate).toHaveBeenCalledWith(
      'm-1',
      'c-1',
      { verdict: 'MET', evidence: 'run 812' },
      { actorMemberId: 'mem-1', sourceSessionId: 'cc-1' }
    )
  })

  it('rejects an unknown verdict value with 400 and maps a grounding 422 through', async () => {
    const bad = await POST(
      jsonRequest('http://x/v', 'POST', { verdict: 'PASSED' }),
      verdictParams
    )
    expect(bad.status).toBe(400)
    expect(mockAdjudicate).not.toHaveBeenCalled()

    mockAdjudicate.mockRejectedValue(
      Object.assign(new Error('needs evidence'), { status: 422 })
    )
    const ungrounded = await POST(
      jsonRequest('http://x/v', 'POST', { verdict: 'MET' }),
      verdictParams
    )
    expect(ungrounded.status).toBe(422)
  })
})
