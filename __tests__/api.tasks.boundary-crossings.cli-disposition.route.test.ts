/**
 * @jest-environment node
 *
 * LUM-769 — the CLI disposition route is the bearer-only counterpart of the
 * web disposition route: a Clerk (human/browser) identity is refused 403
 * BEFORE the body is parsed, a bearer caller reaches the service with
 * `channel: 'CLI'`, and the body is strict — the OPEN revert sentinel and the
 * LUM-751 suppression opt-in are unrepresentable here (they stay web-only).
 */
import { POST } from '@/app/api/tasks/[id]/boundary-crossings/[crossingId]/disposition/route'
import { POST as POST_RECEIPT } from '@/app/api/tasks/[id]/boundary-crossings/[crossingId]/disposition/receipt/route'
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
// LUM-1059: a `<TEAM>-X<n>` ref resolves to the cuid before any service call.
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findIdByTaskAndNumber: jest.fn(async () => 'bc-1'),
  },
}))
jest.mock('@/lib/services/boundary-crossing.service', () => ({
  boundaryCrossingService: {
    disposition: jest.fn(),
    issueReadReceipt: jest.fn(),
    acknowledgeReadReceipt: jest.fn(),
    verifyReadReceipt: jest.fn(),
  },
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFindByIdentifier =
  taskRepository.findByWorkspaceIdentifier as jest.Mock
const mockDisposition = boundaryCrossingService.disposition as jest.Mock
const mockIssue = boundaryCrossingService.issueReadReceipt as jest.Mock
const mockAck = boundaryCrossingService.acknowledgeReadReceipt as jest.Mock
const mockVerify = boundaryCrossingService.verifyReadReceipt as jest.Mock
const RECEIPT = 'r2.1.2.3.sig'
const R1 = 'r1.1.2.sig'
const HANDSHAKE = {
  readAt: '2026-09-14T10:00:00.000Z',
  readAcknowledgedAt: '2026-09-14T10:01:00.000Z',
}

const CLERK_IDENTITY = {
  clerkId: 'clerk-1',
  memberId: 'member-1',
  workspaceId: 'w-1',
  source: 'clerk' as const,
}
const BEARER_IDENTITY = { ...CLERK_IDENTITY, source: 'bearer' as const }

function req(body?: unknown, headers: Record<string, string> = {}) {
  const json = jest.fn(async () => {
    if (body === undefined) throw new Error('no body')
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
  params: Promise.resolve({ id: 'LUM-769', crossingId: 'bc-1' }),
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(BEARER_IDENTITY)
  mockFindByIdentifier.mockResolvedValue({ id: 't-1' })
  mockDisposition.mockResolvedValue({
    crossingId: 'bc-1',
    disposition: 'FALSE_POSITIVE',
  })
  mockVerify.mockResolvedValue(HANDSHAKE)
  mockIssue.mockResolvedValue({
    receipt: R1,
    stage: 'READ',
    expiresAt: '2026-09-14T10:10:00.000Z',
    readAt: HANDSHAKE.readAt,
    readAcknowledgedAt: null,
  })
  mockAck.mockResolvedValue({
    receipt: RECEIPT,
    stage: 'ACK',
    expiresAt: '2026-09-14T10:11:00.000Z',
    readAt: HANDSHAKE.readAt,
    readAcknowledgedAt: HANDSHAKE.readAcknowledgedAt,
  })
})

describe('POST /api/tasks/[id]/boundary-crossings/[crossingId]/disposition (CLI, LUM-769)', () => {
  it('a clerk (human/browser) identity is rejected 403 before the body is parsed', async () => {
    mockIdentity.mockResolvedValue(CLERK_IDENTITY)
    const { request, json } = req({
      disposition: 'FALSE_POSITIVE',
      receipt: RECEIPT,
    })
    const res = await POST(request, params)
    expect(res.status).toBe(403)
    expect(json).not.toHaveBeenCalled()
    expect(mockDisposition).not.toHaveBeenCalled()
  })

  it('a bearer caller records the ruling with channel CLI and the optional note', async () => {
    const { request } = req(
      {
        disposition: 'FALSE_POSITIVE',
        dispositionNote: 'covered by run-outbound tests',
        receipt: RECEIPT,
      },
      { 'X-Lumo-Session-Id': 'sess-1' }
    )
    const res = await POST(request, params)
    expect(res.status).toBe(200)
    // The receipt is verified for this crossing/ruling/caller BEFORE the write.
    expect(mockVerify).toHaveBeenCalledWith(
      't-1',
      'bc-1',
      'FALSE_POSITIVE',
      RECEIPT,
      { sessionId: 'sess-1', memberId: 'member-1' }
    )
    expect(mockVerify.mock.invocationCallOrder[0] as number).toBeLessThan(
      mockDisposition.mock.invocationCallOrder[0] as number
    )
    expect(mockDisposition).toHaveBeenCalledWith(
      't-1',
      'bc-1',
      'FALSE_POSITIVE',
      'covered by run-outbound tests',
      {
        actorMemberId: 'member-1',
        actorClerkId: 'clerk-1',
        channel: 'CLI',
        handshake: HANDSHAKE,
        audit: {
          workspaceId: 'w-1',
          context: expect.objectContaining({ source: 'CLI' }),
        },
      }
    )
    // The LUM-751 suppression options are never forwarded from this route.
    expect(mockDisposition.mock.calls[0]).toHaveLength(5)
    await expect(res.json()).resolves.toEqual({
      crossingId: 'bc-1',
      disposition: 'FALSE_POSITIVE',
      channel: 'CLI',
    })
  })

  it('the note is optional: CONFIRMED with no note reaches the service with a null note', async () => {
    const { request } = req({ disposition: 'CONFIRMED', receipt: RECEIPT })
    const res = await POST(request, params)
    expect(res.status).toBe(200)
    expect(mockDisposition.mock.calls[0][2]).toBe('CONFIRMED')
    expect(mockDisposition.mock.calls[0][3]).toBeNull()
  })

  it.each([
    ['the OPEN revert sentinel', { disposition: 'OPEN', receipt: RECEIPT }],
    [
      'the suppression opt-in',
      {
        disposition: 'FALSE_POSITIVE',
        suppressSimilarInProject: true,
        receipt: RECEIPT,
      },
    ],
    [
      'a smuggled crossingId',
      {
        disposition: 'FALSE_POSITIVE',
        crossingId: 'bc-other',
        receipt: RECEIPT,
      },
    ],
    ['a missing disposition', { dispositionNote: 'x', receipt: RECEIPT }],
    ['a missing read receipt', { disposition: 'FALSE_POSITIVE' }],
    ['a non-JSON body', undefined],
  ])(
    'the body is strict: %s is a 400 and nothing is written',
    async (_label, body) => {
      const { request } = req(body)
      const res = await POST(request, params)
      expect(res.status).toBe(400)
      expect(mockDisposition).not.toHaveBeenCalled()
      expect(mockVerify).not.toHaveBeenCalled()
    }
  )

  it('receipt: confirming with a stage-1 receipt (read not acknowledged) is a 409 that says to confirm the read first, nothing written', async () => {
    mockVerify.mockRejectedValueOnce(
      Object.assign(
        new Error(
          'Refused: read not yet acknowledged — run the command with --confirm-read (the receipt from the envelope) first; only the receipt that step returns is accepted with --confirm.'
        ),
        { status: 409 }
      )
    )
    const { request } = req({ disposition: 'CONFIRMED', receipt: R1 })
    const res = await POST(request, params)
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: expect.stringMatching(/read not yet acknowledged.*--confirm-read/),
    })
    expect(mockDisposition).not.toHaveBeenCalled()
  })

  it('receipt rejected by the server (forged / expired / stale / another reader) is a 409 and nothing is written', async () => {
    mockVerify.mockRejectedValueOnce(
      Object.assign(
        new Error(
          'Refused: the read receipt does not match this crossing, ruling, caller, or the crossing has changed since it was read. Re-run the command without --confirm to read the crossing again and get a fresh envelope.'
        ),
        { status: 409 }
      )
    )
    const { request } = req({ disposition: 'CONFIRMED', receipt: 'r1.1.2.bad' })
    const res = await POST(request, params)
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: expect.stringMatching(/^Refused: the read receipt/),
    })
    expect(mockDisposition).not.toHaveBeenCalled()
  })

  it('an unknown task is 404 and a crossing off the task surfaces the service 404', async () => {
    mockFindByIdentifier.mockResolvedValueOnce(null)
    const first = await POST(
      req({ disposition: 'CONFIRMED', receipt: RECEIPT }).request,
      params
    )
    expect(first.status).toBe(404)
    expect(mockDisposition).not.toHaveBeenCalled()

    mockDisposition.mockRejectedValueOnce(
      Object.assign(new Error('Boundary-crossing not found on this task'), {
        status: 404,
      })
    )
    const second = await POST(
      req({ disposition: 'CONFIRMED', receipt: RECEIPT }).request,
      params
    )
    expect(second.status).toBe(404)
    await expect(second.json()).resolves.toEqual({
      error: 'Boundary-crossing not found on this task',
    })
  })
})

describe('POST /api/tasks/[id]/boundary-crossings/[crossingId]/disposition/receipt (read step, LUM-769)', () => {
  it('receipt route is bearer-only: a clerk identity is rejected 403 before the body is parsed', async () => {
    mockIdentity.mockResolvedValue(CLERK_IDENTITY)
    const { request, json } = req({ disposition: 'FALSE_POSITIVE' })
    const res = await POST_RECEIPT(request, params)
    expect(res.status).toBe(403)
    expect(json).not.toHaveBeenCalled()
    expect(mockIssue).not.toHaveBeenCalled()
  })

  it('receipt route stage 1 signs the crossing for the named ruling and this caller, and writes nothing', async () => {
    const { request } = req(
      { disposition: 'CONFIRMED' },
      { 'X-Lumo-Session-Id': 'sess-1' }
    )
    const res = await POST_RECEIPT(request, params)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      receipt: R1,
      stage: 'READ',
      readAcknowledgedAt: null,
    })
    expect(mockIssue).toHaveBeenCalledWith('t-1', 'bc-1', 'CONFIRMED', {
      sessionId: 'sess-1',
      memberId: 'member-1',
    })
    expect(mockAck).not.toHaveBeenCalled()
    expect(mockDisposition).not.toHaveBeenCalled()
  })

  it('receipt route stage 2 (acknowledge) verifies the stage-1 receipt and returns the stage-2 receipt, writing nothing', async () => {
    const { request } = req(
      { disposition: 'CONFIRMED', acknowledge: R1 },
      { 'X-Lumo-Session-Id': 'sess-1' }
    )
    const res = await POST_RECEIPT(request, params)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      receipt: RECEIPT,
      stage: 'ACK',
      readAcknowledgedAt: HANDSHAKE.readAcknowledgedAt,
    })
    expect(mockAck).toHaveBeenCalledWith('t-1', 'bc-1', 'CONFIRMED', R1, {
      sessionId: 'sess-1',
      memberId: 'member-1',
    })
    expect(mockIssue).not.toHaveBeenCalled()
    expect(mockDisposition).not.toHaveBeenCalled()

    // A bad stage-1 receipt at the acknowledge step is the service's 409.
    mockAck.mockRejectedValueOnce(
      Object.assign(new Error('Refused: the read receipt has expired.'), {
        status: 409,
      })
    )
    const stale = await POST_RECEIPT(
      req({ disposition: 'CONFIRMED', acknowledge: 'r1.0.0.old' }).request,
      params
    )
    expect(stale.status).toBe(409)
  })

  it('receipt route body is strict and the service 404 / 503 pass through', async () => {
    const bad = await POST_RECEIPT(req({ disposition: 'OPEN' }).request, params)
    expect(bad.status).toBe(400)
    expect(mockIssue).not.toHaveBeenCalled()

    mockIssue.mockRejectedValueOnce(
      Object.assign(new Error('Read-receipt signing is not configured'), {
        status: 503,
      })
    )
    const unconfigured = await POST_RECEIPT(
      req({ disposition: 'CONFIRMED' }).request,
      params
    )
    expect(unconfigured.status).toBe(503)
  })
})

describe('LUM-1059 crossing ref on the CLI disposition routes', () => {
  const refParams = {
    params: Promise.resolve({ id: 'LUM-769', crossingId: 'LUM-X7' }),
  }

  it('LUM-1059 a receipt issued via the ref is issued for the cuid, and the ruling via the ref verifies against the cuid', async () => {
    const issue = req({ disposition: 'FALSE_POSITIVE' })
    const issued = await POST_RECEIPT(issue.request, refParams)
    expect(issued.status).toBe(200)
    expect(mockIssue).toHaveBeenCalledWith(
      't-1',
      'bc-1',
      'FALSE_POSITIVE',
      expect.anything()
    )

    const rule = req({ disposition: 'FALSE_POSITIVE', receipt: RECEIPT })
    const res = await POST(rule.request, refParams)
    expect(res.status).toBe(200)
    expect(mockVerify).toHaveBeenCalledWith(
      't-1',
      'bc-1',
      'FALSE_POSITIVE',
      RECEIPT,
      expect.anything()
    )
    expect(mockDisposition.mock.calls[0]![1]).toBe('bc-1')
  })
})
