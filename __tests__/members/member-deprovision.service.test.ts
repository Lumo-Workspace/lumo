/**
 * @jest-environment node
 *
 * LUM-906 PR2 — deprovisioning never lets a failed integration cleanup stop
 * the deactivation (API keys revoked first), and fails the delivery so
 * Clerk retries; the retry only finishes the cleanup.
 */
const mockFindAll = jest.fn()
const mockCountOwners = jest.fn()
const mockDeactivate = jest.fn()
const mockCleanup = jest.fn()
const mockAudit = jest.fn()

jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findAllByClerkIdIncludingDeactivated: (...a: unknown[]) =>
      mockFindAll(...a),
    countOwners: (...a: unknown[]) => mockCountOwners(...a),
    deactivate: (...a: unknown[]) => mockDeactivate(...a),
    revokeActiveApiKeys: jest.fn(),
  },
}))
jest.mock('@/lib/services/member-integrations.service', () => ({
  removeMemberIntegrationsSafely: (...a: unknown[]) => mockCleanup(...a),
}))
jest.mock('@/lib/services/audit.service', () => ({
  recordAuditEvent: (...a: unknown[]) => mockAudit(...a),
}))

import { memberDeprovisionService } from '@/lib/services/member-deprovision.service'

const CTX = { actor: { type: 'SYSTEM' as const }, source: 'WEBHOOK' as const }
const TRIGGER = {
  clerkUserId: 'user_1',
  reason: 'CLERK_USER_DELETED' as const,
  webhookId: 'msg_1',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDeactivate.mockResolvedValue({ deactivated: true, apiKeysRevoked: 2 })
})

describe('LUM-906 deprovisioning and integration cleanup', () => {
  it('deprovision deactivates first and still fails the delivery when integration cleanup fails', async () => {
    mockFindAll.mockResolvedValue([
      { id: 'm1', workspaceId: 'ws-1', role: 'MEMBER', deactivatedAt: null },
    ])
    mockCleanup.mockResolvedValue(false)

    await expect(
      memberDeprovisionService.deprovisionClerkUser(TRIGGER, CTX)
    ).rejects.toMatchObject({ status: 500 })

    expect(mockDeactivate).toHaveBeenCalledWith('m1', 'CLERK_USER_DELETED')
    expect(mockDeactivate.mock.invocationCallOrder[0]).toBeLessThan(
      mockCleanup.mock.invocationCallOrder[0]!
    )
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'member.deprovisioned' })
    )
    expect(mockCleanup).toHaveBeenCalledWith('ws-1', 'm1', CTX)
  })

  it('deprovision retry only finishes the cleanup of an already deactivated membership', async () => {
    mockFindAll.mockResolvedValue([
      {
        id: 'm1',
        workspaceId: 'ws-1',
        role: 'MEMBER',
        deactivatedAt: new Date(),
      },
    ])
    mockCleanup.mockResolvedValue(true)

    const outcomes = await memberDeprovisionService.deprovisionClerkUser(
      TRIGGER,
      CTX
    )

    expect(outcomes).toEqual([
      { workspaceId: 'ws-1', memberId: 'm1', outcome: 'already_deactivated' },
    ])
    expect(mockCleanup).toHaveBeenCalledWith('ws-1', 'm1', CTX)
    expect(mockDeactivate).not.toHaveBeenCalled()
    expect(mockAudit).not.toHaveBeenCalled()
  })
})
