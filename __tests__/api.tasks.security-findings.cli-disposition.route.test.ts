/**
 * @jest-environment node
 *
 * LUM-750 — the CLI finding-disposition routes are the bearer-only twins of
 * the LUM-769 crossing routes: a Clerk (human/browser) identity is refused
 * 403 BEFORE the body is parsed on every write/receipt route, the write
 * requires a stage-2 receipt (missing = 400, strict schema), the receipt
 * verdict runs before the write (a 409 writes nothing), the bulk write goes
 * through the suggested-set handshake, and the list route is readable by
 * both identities.
 */
import { GET as GET_LIST } from '@/app/api/tasks/[id]/security-findings/route'
import { POST as POST_RECEIPT } from '@/app/api/tasks/[id]/security-findings/[findingId]/disposition/receipt/route'
import { POST as POST_CLI } from '@/app/api/tasks/[id]/security-findings/[findingId]/disposition/cli/route'
import { POST as POST_BULK_RECEIPT } from '@/app/api/tasks/[id]/security-findings/bulk-disposition/receipt/route'
import { POST as POST_BULK_CLI } from '@/app/api/tasks/[id]/security-findings/bulk-disposition/cli/route'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { securityFindingCliDispositionService } from '@/lib/services/security-finding-cli-disposition.service'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/api/resolve-task-param', () => ({
  resolveTaskParam: jest.fn(),
}))
jest.mock('@/lib/services/security-finding-cli-disposition.service', () => ({
  securityFindingCliDispositionService: {
    listForTask: jest.fn(),
    issueReadReceipt: jest.fn(),
    acknowledgeReadReceipt: jest.fn(),
    verifyReadReceipt: jest.fn(),
    disposition: jest.fn(),
    issueBulkReadReceipt: jest.fn(),
    acknowledgeBulkReadReceipt: jest.fn(),
    verifyBulkReadReceipt: jest.fn(),
    dispositionSuggested: jest.fn(),
  },
}))

const identity = requireIdentity as jest.Mock
const resolveTask = resolveTaskParam as jest.Mock
const svc = securityFindingCliDispositionService as unknown as Record<
  keyof typeof securityFindingCliDispositionService,
  jest.Mock
>

const CLERK = {
  clerkId: 'clerk-1',
  memberId: 'member-1',
  workspaceId: 'w-1',
  source: 'clerk' as const,
}
const BEARER = { ...CLERK, source: 'bearer' as const }
const R1 = 'r1.1.2.sig'
const R2 = 'r2.1.2.3.sig'
const HANDSHAKE = {
  readAt: '2026-09-14T10:00:00.000Z',
  readAcknowledgedAt: '2026-09-14T10:01:00.000Z',
}

function req(body?: unknown, headers: Record<string, string> = {}) {
  const json = jest.fn(async () => {
    if (body === undefined) throw new Error('body must not be read')
    return body
  })
  return {
    request: {
      json,
      headers: { get: (k: string) => headers[k] ?? null },
    } as never,
    json,
  }
}
const params = {
  params: Promise.resolve({ id: 'LUM-750', findingId: 'f-1' }),
}
const taskParams = { params: Promise.resolve({ id: 'LUM-750' }) }

beforeEach(() => {
  jest.clearAllMocks()
  identity.mockResolvedValue(BEARER)
  resolveTask.mockResolvedValue({ id: 't-1' })
  svc.verifyReadReceipt.mockResolvedValue(HANDSHAKE)
  svc.verifyBulkReadReceipt.mockResolvedValue(HANDSHAKE)
  svc.disposition.mockResolvedValue({
    id: 'f-1',
    disposition: 'FALSE_POSITIVE',
    channel: 'CLI',
  })
  svc.dispositionSuggested.mockResolvedValue({
    confirmed: 2,
    findingIds: ['f-1', 'f-3'],
    channel: 'CLI',
  })
  svc.issueReadReceipt.mockResolvedValue({ receipt: R1, stage: 'READ' })
  svc.acknowledgeReadReceipt.mockResolvedValue({ receipt: R2, stage: 'ACK' })
  svc.issueBulkReadReceipt.mockResolvedValue({
    receipt: R1,
    stage: 'READ',
    findings: [{ id: 'f-1' }],
  })
  svc.acknowledgeBulkReadReceipt.mockResolvedValue({
    receipt: R2,
    stage: 'ACK',
    findings: [{ id: 'f-1' }],
  })
  svc.listForTask.mockResolvedValue({ findings: [{ id: 'f-1' }] })
})

describe('GET /api/tasks/[id]/security-findings (LUM-750)', () => {
  it.each([CLERK, BEARER])('lists the findings for a %s identity', async id => {
    identity.mockResolvedValue(id)
    const res = await GET_LIST(req().request, taskParams)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ findings: [{ id: 'f-1' }] })
    expect(svc.listForTask).toHaveBeenCalledWith('t-1')
  })
  it('404 when the task does not resolve', async () => {
    resolveTask.mockResolvedValue(null)
    expect((await GET_LIST(req().request, taskParams)).status).toBe(404)
  })
})

describe('POST …/[findingId]/disposition/receipt (LUM-750)', () => {
  it('refuses a Clerk identity with 403 before the body is read', async () => {
    identity.mockResolvedValue(CLERK)
    const { request, json } = req({ disposition: 'FALSE_POSITIVE' })
    const res = await POST_RECEIPT(request, params)
    expect(res.status).toBe(403)
    expect(json).not.toHaveBeenCalled()
    expect(svc.issueReadReceipt).not.toHaveBeenCalled()
  })

  it('stage 1: issues a receipt for the ruling, bound to the caller session + member', async () => {
    const { request } = req(
      { disposition: 'ACCEPTED_RISK' },
      { 'X-Lumo-Session-Id': 'sess-1' }
    )
    const res = await POST_RECEIPT(request, params)
    expect(res.status).toBe(200)
    expect(svc.issueReadReceipt).toHaveBeenCalledWith(
      't-1',
      'f-1',
      'ACCEPTED_RISK',
      { sessionId: 'sess-1', memberId: 'member-1' }
    )
    expect(await res.json()).toEqual({ receipt: R1, stage: 'READ' })
  })

  it('stage 2: `acknowledge` routes to the acknowledgement; a service 409 is passed through', async () => {
    const { request } = req({ disposition: 'FALSE_POSITIVE', acknowledge: R1 })
    expect((await POST_RECEIPT(request, params)).status).toBe(200)
    expect(svc.acknowledgeReadReceipt).toHaveBeenCalledWith(
      't-1',
      'f-1',
      'FALSE_POSITIVE',
      R1,
      { sessionId: null, memberId: 'member-1' }
    )
    svc.acknowledgeReadReceipt.mockRejectedValue(
      Object.assign(new Error('the read receipt has expired'), { status: 409 })
    )
    const res = await POST_RECEIPT(
      req({ disposition: 'FALSE_POSITIVE', acknowledge: R1 }).request,
      params
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('expired')
  })

  it('400 on an unknown ruling or an extra field', async () => {
    expect(
      (await POST_RECEIPT(req({ disposition: 'CONFIRMED' }).request, params))
        .status
    ).toBe(400)
    expect(
      (
        await POST_RECEIPT(
          req({ disposition: 'FALSE_POSITIVE', receipt: R1 }).request,
          params
        )
      ).status
    ).toBe(400)
  })
})

describe('POST …/[findingId]/disposition/cli (LUM-750)', () => {
  it('refuses a Clerk identity with 403 before the body is read', async () => {
    identity.mockResolvedValue(CLERK)
    const { request, json } = req({
      disposition: 'FALSE_POSITIVE',
      receipt: R2,
    })
    const res = await POST_CLI(request, params)
    expect(res.status).toBe(403)
    expect(json).not.toHaveBeenCalled()
    expect(svc.disposition).not.toHaveBeenCalled()
  })

  it('a body without a receipt is 400 — nothing verified, nothing written', async () => {
    const res = await POST_CLI(
      req({ disposition: 'FALSE_POSITIVE' }).request,
      params
    )
    expect(res.status).toBe(400)
    expect(svc.verifyReadReceipt).not.toHaveBeenCalled()
    expect(svc.disposition).not.toHaveBeenCalled()
  })

  it('a stage-1 receipt (409 from verify) writes nothing and says to confirm the read first', async () => {
    svc.verifyReadReceipt.mockRejectedValue(
      Object.assign(
        new Error('read not yet acknowledged — run --confirm-read first'),
        {
          status: 409,
        }
      )
    )
    const res = await POST_CLI(
      req({ disposition: 'FALSE_POSITIVE', receipt: R1 }).request,
      params
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('read not yet acknowledged')
    expect(svc.disposition).not.toHaveBeenCalled()
  })

  it('a valid stage-2 receipt writes with channel CLI, the handshake times and the session', async () => {
    const res = await POST_CLI(
      req(
        { disposition: 'ACCEPTED_RISK', note: 'known', receipt: R2 },
        { 'X-Lumo-Session-Id': 'sess-9' }
      ).request,
      params
    )
    expect(res.status).toBe(200)
    expect(svc.verifyReadReceipt).toHaveBeenCalledWith(
      't-1',
      'f-1',
      'ACCEPTED_RISK',
      R2,
      { sessionId: 'sess-9', memberId: 'member-1' }
    )
    expect(svc.disposition).toHaveBeenCalledWith(
      't-1',
      'f-1',
      'ACCEPTED_RISK',
      'known',
      { actorMemberId: 'member-1', sessionId: 'sess-9', handshake: HANDSHAKE }
    )
    expect((await res.json()).channel).toBe('CLI')
  })

  it('the schema is narrower than the web route: CONFIRMED / OPEN are unrepresentable', async () => {
    for (const disposition of ['CONFIRMED', 'OPEN']) {
      const res = await POST_CLI(
        req({ disposition, receipt: R2 }).request,
        params
      )
      expect(res.status).toBe(400)
    }
    expect(svc.disposition).not.toHaveBeenCalled()
  })
})

describe('POST …/bulk-disposition/receipt + /cli (LUM-750)', () => {
  it('both refuse a Clerk identity with 403 before the body is read', async () => {
    identity.mockResolvedValue(CLERK)
    const a = req({})
    expect((await POST_BULK_RECEIPT(a.request, taskParams)).status).toBe(403)
    expect(a.json).not.toHaveBeenCalled()
    const b = req({
      disposition: 'FALSE_POSITIVE',
      scope: 'SUGGESTED',
      receipt: R2,
    })
    expect((await POST_BULK_CLI(b.request, taskParams)).status).toBe(403)
    expect(b.json).not.toHaveBeenCalled()
    expect(svc.dispositionSuggested).not.toHaveBeenCalled()
  })

  it('the receipt route issues (stage 1) or acknowledges (stage 2) the suggested-set receipt and lists the rows', async () => {
    const res = await POST_BULK_RECEIPT(req({}).request, taskParams)
    expect(res.status).toBe(200)
    expect(svc.issueBulkReadReceipt).toHaveBeenCalledWith('t-1', {
      sessionId: null,
      memberId: 'member-1',
    })
    expect((await res.json()).findings).toEqual([{ id: 'f-1' }])
    await POST_BULK_RECEIPT(req({ acknowledge: R1 }).request, taskParams)
    expect(svc.acknowledgeBulkReadReceipt).toHaveBeenCalledWith('t-1', R1, {
      sessionId: null,
      memberId: 'member-1',
    })
    // An empty suggested set is the service's 422 — passed through.
    svc.issueBulkReadReceipt.mockRejectedValue(
      Object.assign(new Error('nothing to rule on'), { status: 422 })
    )
    expect((await POST_BULK_RECEIPT(req({}).request, taskParams)).status).toBe(
      422
    )
  })

  it('the bulk write requires the stage-2 receipt (400 without), verifies it first (409 writes nothing), then confirms the set', async () => {
    expect(
      (
        await POST_BULK_CLI(
          req({ disposition: 'FALSE_POSITIVE', scope: 'SUGGESTED' }).request,
          taskParams
        )
      ).status
    ).toBe(400)
    svc.verifyBulkReadReceipt.mockRejectedValueOnce(
      Object.assign(new Error('the suggested findings changed'), {
        status: 409,
      })
    )
    expect(
      (
        await POST_BULK_CLI(
          req({
            disposition: 'FALSE_POSITIVE',
            scope: 'SUGGESTED',
            receipt: R2,
          }).request,
          taskParams
        )
      ).status
    ).toBe(409)
    expect(svc.dispositionSuggested).not.toHaveBeenCalled()
    const res = await POST_BULK_CLI(
      req(
        { disposition: 'FALSE_POSITIVE', scope: 'SUGGESTED', receipt: R2 },
        { 'X-Lumo-Session-Id': 'sess-9' }
      ).request,
      taskParams
    )
    expect(res.status).toBe(200)
    expect(svc.dispositionSuggested).toHaveBeenCalledWith('t-1', {
      actorMemberId: 'member-1',
      sessionId: 'sess-9',
      handshake: HANDSHAKE,
    })
    expect(await res.json()).toEqual({
      confirmed: 2,
      findingIds: ['f-1', 'f-3'],
      channel: 'CLI',
    })
  })
})
