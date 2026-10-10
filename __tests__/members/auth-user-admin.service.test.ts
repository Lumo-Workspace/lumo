/**
 * @jest-environment node
 *
 * LUM-1071 — the auth admin service's ordering and guards with mocked
 * repositories (the real-Postgres suite covers the end-to-end behaviour).
 */
const mockRepo = {
  findBanState: jest.fn(),
  findIdByEmail: jest.fn(),
  countCredentials: jest.fn(),
  banAndRevoke: jest.fn(),
  clearBan: jest.fn(),
  deleteUser: jest.fn(),
}
const mockDeprovision = {
  planDeprovision: jest.fn(),
  deprovisionUser: jest.fn(),
}

jest.mock('@/lib/repositories/auth-user-admin.repository', () => ({
  get authUserAdminRepository() {
    return mockRepo
  },
}))
jest.mock('@/lib/services/member-deprovision.service', () => ({
  get memberDeprovisionService() {
    return mockDeprovision
  },
}))
jest.mock('@/lib/services/audit.service', () => ({
  SYSTEM_AUDIT_CONTEXT: { actor: { type: 'SYSTEM' }, source: 'SYSTEM' },
}))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import {
  authUserAdminService,
  lastOwnerWorkspaces,
} from '@/lib/services/auth-user-admin.service'

const USER = { id: 'user_1', role: 'user', banned: false, banExpires: null }
const SYSTEM = { actor: { type: 'SYSTEM' }, source: 'SYSTEM' }

beforeEach(() => {
  jest.clearAllMocks()
  mockRepo.findBanState.mockResolvedValue(USER)
  mockRepo.banAndRevoke.mockResolvedValue({
    sessionsRevoked: 2,
    oauthTokensRevoked: 1,
  })
  mockRepo.deleteUser.mockResolvedValue({
    deleted: true,
    sessionsRevoked: 1,
    oauthTokensRevoked: 0,
  })
  mockDeprovision.planDeprovision.mockResolvedValue([])
  mockDeprovision.deprovisionUser.mockResolvedValue([])
})

describe('LUM-1071 auth admin service', () => {
  it('auth admin resolveUserId takes exactly one of id / email', async () => {
    await expect(
      authUserAdminService.resolveUserId({ userId: ' user_1 ' })
    ).resolves.toBe('user_1')
    mockRepo.findIdByEmail.mockResolvedValueOnce('user_2')
    await expect(
      authUserAdminService.resolveUserId({ email: 'a@b.test' })
    ).resolves.toBe('user_2')
    await expect(authUserAdminService.resolveUserId({})).rejects.toMatchObject({
      status: 400,
    })
    await expect(
      authUserAdminService.resolveUserId({ userId: 'u', email: 'a@b.test' })
    ).rejects.toMatchObject({ status: 400 })
    mockRepo.findIdByEmail.mockResolvedValueOnce(null)
    const err = await authUserAdminService
      .resolveUserId({ email: 'nobody@b.test' })
      .catch((e: Error) => e)
    expect(err).toMatchObject({ status: 404 })
    // The email is not echoed back.
    expect((err as Error).message).not.toContain('nobody@b.test')
  })

  it('auth admin ban sets the ban before deprovisioning, with the AUTH_USER_BANNED reason', async () => {
    const expiresAt = new Date('2026-11-01T00:00:00Z')
    await authUserAdminService.ban('user_1', { reason: 'spam', expiresAt })
    expect(mockRepo.banAndRevoke).toHaveBeenCalledWith('user_1', {
      reason: 'spam',
      expiresAt,
    })
    expect(mockDeprovision.deprovisionUser).toHaveBeenCalledWith(
      {
        userId: 'user_1',
        reason: 'AUTH_USER_BANNED',
        auditMetadata: { trigger: 'auth-admin' },
      },
      SYSTEM
    )
    expect(mockRepo.banAndRevoke.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeprovision.deprovisionUser.mock.invocationCallOrder[0]!
    )
  })

  it('auth admin ban without options writes a permanent ban with no reason', async () => {
    await authUserAdminService.ban('user_1')
    expect(mockRepo.banAndRevoke).toHaveBeenCalledWith('user_1', {
      reason: null,
      expiresAt: null,
    })
  })

  it('auth admin ban / unban of an unknown user is a 404 and writes nothing', async () => {
    mockRepo.findBanState.mockResolvedValue(null)
    await expect(authUserAdminService.ban('user_x')).rejects.toMatchObject({
      status: 404,
    })
    await expect(authUserAdminService.unban('user_x')).rejects.toMatchObject({
      status: 404,
    })
    expect(mockRepo.banAndRevoke).not.toHaveBeenCalled()
    expect(mockRepo.clearBan).not.toHaveBeenCalled()
    expect(mockDeprovision.deprovisionUser).not.toHaveBeenCalled()
  })

  it('auth admin remove refuses a last OWNER before writing anything', async () => {
    mockDeprovision.planDeprovision.mockResolvedValue([
      {
        workspaceId: 'ws_a',
        memberId: 'm1',
        role: 'OWNER',
        action: 'keep_last_owner',
      },
    ])
    await expect(authUserAdminService.remove('user_1')).rejects.toMatchObject({
      status: 409,
    })
    expect(mockDeprovision.deprovisionUser).not.toHaveBeenCalled()
    expect(mockRepo.deleteUser).not.toHaveBeenCalled()
  })

  it('auth admin remove does not delete the identity if deprovisioning kept a last OWNER (race)', async () => {
    mockDeprovision.planDeprovision.mockResolvedValue([
      {
        workspaceId: 'ws_a',
        memberId: 'm1',
        role: 'OWNER',
        action: 'deactivate',
      },
    ])
    mockDeprovision.deprovisionUser.mockResolvedValue([
      {
        workspaceId: 'ws_a',
        memberId: 'm1',
        outcome: 'last_owner_kept',
        apiKeysRevoked: 0,
      },
    ])
    await expect(authUserAdminService.remove('user_1')).rejects.toMatchObject({
      status: 409,
    })
    expect(mockRepo.deleteUser).not.toHaveBeenCalled()
  })

  it('auth admin remove deprovisions with AUTH_USER_DELETED, then deletes the user', async () => {
    const result = await authUserAdminService.remove('user_1')
    expect(mockDeprovision.deprovisionUser).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'AUTH_USER_DELETED' }),
      SYSTEM
    )
    expect(
      mockDeprovision.deprovisionUser.mock.invocationCallOrder[0]
    ).toBeLessThan(mockRepo.deleteUser.mock.invocationCallOrder[0]!)
    expect(result).toEqual({
      userId: 'user_1',
      outcome: 'removed',
      sessionsRevoked: 1,
      oauthTokensRevoked: 0,
      memberships: [],
    })
  })

  it('auth admin remove of a missing user: already_removed only when nothing is live', async () => {
    mockRepo.findBanState.mockResolvedValue(null)
    mockDeprovision.planDeprovision.mockResolvedValue([
      { workspaceId: 'ws_a', memberId: 'm1', role: 'MEMBER', action: 'none' },
    ])
    await expect(authUserAdminService.remove('user_1')).resolves.toEqual({
      userId: 'user_1',
      outcome: 'already_removed',
    })
    mockDeprovision.planDeprovision.mockResolvedValue([
      {
        workspaceId: 'ws_a',
        memberId: 'm1',
        role: 'MEMBER',
        action: 'deactivate',
      },
    ])
    await expect(authUserAdminService.remove('user_1')).rejects.toMatchObject({
      status: 404,
    })
    expect(mockDeprovision.deprovisionUser).not.toHaveBeenCalled()
    expect(mockRepo.deleteUser).not.toHaveBeenCalled()
  })

  it('auth admin plan reads only (no write calls)', async () => {
    mockRepo.countCredentials.mockResolvedValue({ sessions: 3, oauthTokens: 4 })
    const plan = await authUserAdminService.plan('user_1')
    expect(plan).toEqual({
      userId: 'user_1',
      user: USER,
      sessions: 3,
      oauthTokens: 4,
      memberships: [],
    })
    expect(mockRepo.banAndRevoke).not.toHaveBeenCalled()
    expect(mockRepo.clearBan).not.toHaveBeenCalled()
    expect(mockRepo.deleteUser).not.toHaveBeenCalled()
    expect(mockDeprovision.deprovisionUser).not.toHaveBeenCalled()
  })

  it('auth admin lastOwnerWorkspaces lists the workspaces a removal would orphan', () => {
    expect(
      lastOwnerWorkspaces([
        {
          workspaceId: 'a',
          memberId: '1',
          role: 'OWNER',
          action: 'keep_last_owner',
        },
        {
          workspaceId: 'b',
          memberId: '2',
          role: 'OWNER',
          action: 'deactivate',
        },
      ])
    ).toEqual(['a'])
  })
})
