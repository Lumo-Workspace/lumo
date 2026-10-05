/**
 * @jest-environment node
 *
 * LUM-740 — "confirm all suspected false positives" is a human-only write
 * path with the same red line as the single disposition route (LUM-732): a
 * bearer/agent identity is refused 403 BEFORE the body is parsed, so an
 * agent can never bulk-clear the suggestions on its own PR.
 */
import { POST } from '@/app/api/tasks/[id]/security-findings/bulk-disposition/route'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { prSecurityScanService } from '@/lib/services/pr-security-scan.service'
import { suggestionOutcomeFor } from '@/lib/security-scan/suggestion'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/api/resolve-task-param', () => ({
  resolveTaskParam: jest.fn(),
}))
jest.mock('@/lib/services/pr-security-scan.service', () => ({
  prSecurityScanService: { dispositionSuggested: jest.fn() },
}))

const identity = requireIdentity as jest.Mock
const resolveTask = resolveTaskParam as jest.Mock
const bulk = prSecurityScanService.dispositionSuggested as jest.Mock

const CLERK = {
  clerkId: 'clerk-1',
  memberId: 'member-1',
  workspaceId: 'w-1',
  source: 'clerk' as const,
}
const BEARER = { ...CLERK, source: 'bearer' as const }
const BODY = { disposition: 'FALSE_POSITIVE', scope: 'SUGGESTED' }

function req(body?: unknown) {
  return {
    json: async () => {
      if (body === undefined) throw new Error('body must not be read')
      return body
    },
    headers: { get: () => null },
  } as never
}
const params = { params: Promise.resolve({ id: 'LUM-740' }) }

describe('LUM-740 bulk disposition', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    identity.mockResolvedValue(CLERK)
    resolveTask.mockResolvedValue({ id: 't-1' })
    bulk.mockResolvedValue({ confirmed: 3 })
  })

  describe('POST /api/tasks/[id]/security-findings/bulk-disposition', () => {
    it('refuses a bearer/agent identity with 403 before the body is read', async () => {
      identity.mockResolvedValue(BEARER)
      const res = await POST(req(), params)
      expect(res.status).toBe(403)
      expect(bulk).not.toHaveBeenCalled()
    })

    it('confirms every suggested false positive on the task for a Clerk identity', async () => {
      const res = await POST(req(BODY), params)
      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ confirmed: 3 })
      expect(bulk).toHaveBeenCalledWith('t-1', 'member-1', {
        workspaceId: 'w-1',
        context: expect.objectContaining({ source: 'WEB' }),
      })
    })

    it('is strict about the body: only FALSE_POSITIVE over SUGGESTED is a bulk operation', async () => {
      expect(
        (
          await POST(
            req({ disposition: 'ACCEPTED_RISK', scope: 'SUGGESTED' }),
            params
          )
        ).status
      ).toBe(400)
      expect((await POST(req({ ...BODY, extra: 1 }), params)).status).toBe(400)
      expect((await POST(req(null), params)).status).toBe(400)
      expect(bulk).not.toHaveBeenCalled()
    })

    it('404s when the task is not in the identity workspace', async () => {
      resolveTask.mockResolvedValue(null)
      expect((await POST(req(BODY), params)).status).toBe(404)
      expect(bulk).not.toHaveBeenCalled()
    })

    it('maps a service error status through', async () => {
      bulk.mockRejectedValue(Object.assign(new Error('nope'), { status: 409 }))
      const res = await POST(req(BODY), params)
      expect(res.status).toBe(409)
      await expect(res.json()).resolves.toEqual({ error: 'nope' })
    })
  })

  describe('suggestionOutcomeFor — the R2 record of a human decision', () => {
    it('CONFIRMED when the human picks the suggested disposition', () => {
      expect(suggestionOutcomeFor('FALSE_POSITIVE', 'FALSE_POSITIVE')).toBe(
        'CONFIRMED'
      )
    })
    it('OVERRULED when the human picks another disposition', () => {
      expect(suggestionOutcomeFor('FALSE_POSITIVE', 'ACCEPTED_RISK')).toBe(
        'OVERRULED'
      )
    })
    it('null when nothing was suggested', () => {
      expect(suggestionOutcomeFor(null, 'FALSE_POSITIVE')).toBeNull()
    })
  })
})
