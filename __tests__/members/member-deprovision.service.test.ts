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
  userId: 'user_1',
  reason: 'AUTH_USER_DELETED' as const,
  auditMetadata: { webhookId: 'msg_1' },
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
      memberDeprovisionService.deprovisionUser(TRIGGER, CTX)
    ).rejects.toMatchObject({ status: 500 })

    expect(mockDeactivate).toHaveBeenCalledWith('m1', 'AUTH_USER_DELETED')
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

    const outcomes = await memberDeprovisionService.deprovisionUser(
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

  it('deprovision plan (LUM-1071) reports per-membership actions and writes nothing', async () => {
    mockFindAll.mockResolvedValue([
      { id: 'm1', workspaceId: 'ws-1', role: 'MEMBER', deactivatedAt: null },
      { id: 'm2', workspaceId: 'ws-2', role: 'OWNER', deactivatedAt: null },
      { id: 'm3', workspaceId: 'ws-3', role: 'OWNER', deactivatedAt: null },
      {
        id: 'm4',
        workspaceId: 'ws-4',
        role: 'MEMBER',
        deactivatedAt: new Date(),
      },
    ])
    mockCountOwners.mockImplementation(async (ws: string) =>
      ws === 'ws-2' ? 1 : 2
    )

    const plan = await memberDeprovisionService.planDeprovision('user_1')

    expect(plan.map(p => [p.memberId, p.action])).toEqual([
      ['m1', 'deactivate'],
      ['m2', 'keep_last_owner'],
      ['m3', 'deactivate'],
      ['m4', 'none'],
    ])
    expect(mockDeactivate).not.toHaveBeenCalled()
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('deprovision for a Better Auth ban (LUM-1071) audits the AUTH_USER_BANNED reason and the trigger', async () => {
    mockFindAll.mockResolvedValue([
      { id: 'm1', workspaceId: 'ws-1', role: 'MEMBER', deactivatedAt: null },
    ])
    mockCleanup.mockResolvedValue(true)

    await memberDeprovisionService.deprovisionUser(
      {
        userId: 'user_1',
        reason: 'AUTH_USER_BANNED',
        auditMetadata: { trigger: 'auth-admin' },
      },
      CTX
    )

    expect(mockFindAll).toHaveBeenCalledWith('user_1')
    expect(mockDeactivate).toHaveBeenCalledWith('m1', 'AUTH_USER_BANNED')
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'member.deprovisioned',
        metadata: {
          reason: 'AUTH_USER_BANNED',
          clerkUserId: 'user_1',
          trigger: 'auth-admin',
          role: 'MEMBER',
          apiKeysRevoked: 2,
        },
      })
    )
  })

  it('deprovision from the Clerk webhook keeps its exact audit metadata', async () => {
    mockFindAll.mockResolvedValue([
      { id: 'm1', workspaceId: 'ws-1', role: 'MEMBER', deactivatedAt: null },
    ])
    mockCleanup.mockResolvedValue(true)

    await memberDeprovisionService.deprovisionUser(TRIGGER, CTX)

    expect(mockAudit.mock.calls[0]![0]).toMatchObject({
      metadata: {
        reason: 'AUTH_USER_DELETED',
        clerkUserId: 'user_1',
        webhookId: 'msg_1',
        role: 'MEMBER',
        apiKeysRevoked: 2,
      },
    })
    expect(
      Object.keys(
        (mockAudit.mock.calls[0]![0] as { metadata: object }).metadata
      )
    ).toEqual(['reason', 'clerkUserId', 'webhookId', 'role', 'apiKeysRevoked'])
  })
})
