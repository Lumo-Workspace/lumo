/**
 * @jest-environment node
 *
 * LUM-906 PR2 — the guards of an OWNER removing a member. The happy path
 * against a real database is in member-lifecycle.real-postgres.test.ts.
 */
import { memberService } from '@/lib/services/member.service'

const mockFindById = jest.fn()
const mockCountOwners = jest.fn()
const mockDeactivate = jest.fn()
const mockRecordAuditEvent = jest.fn()

jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findById: (...a: unknown[]) => mockFindById(...a),
    countOwners: (...a: unknown[]) => mockCountOwners(...a),
    deactivate: (...a: unknown[]) => mockDeactivate(...a),
  },
}))
const mockRemoveIntegrations = jest.fn()
jest.mock('@/lib/services/member-integrations.service', () => ({
  removeMemberIntegrations: (...a: unknown[]) => mockRemoveIntegrations(...a),
}))
jest.mock('@/lib/services/audit.service', () => ({
  recordAuditEvent: (...a: unknown[]) => mockRecordAuditEvent(...a),
}))

const AUDIT = { actor: { type: 'MEMBER' as const }, source: 'WEB' as const }
const OWNER = { memberId: 'm-owner', role: 'OWNER', workspaceId: 'ws-1' }

beforeEach(() => {
  jest.clearAllMocks()
  mockDeactivate.mockResolvedValue({ deactivated: true, apiKeysRevoked: 3 })
  mockRemoveIntegrations.mockResolvedValue([])
})

describe('LUM-906 member removal guards', () => {
  it('member removal is forbidden for a MEMBER', async () => {
    await expect(
      memberService.removeMember(
        'm-2',
        { ...OWNER, memberId: 'm-x', role: 'MEMBER' },
        AUDIT
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(mockDeactivate).not.toHaveBeenCalled()
  })

  it('member removal refuses removing yourself', async () => {
    await expect(
      memberService.removeMember('m-owner', OWNER, AUDIT)
    ).rejects.toMatchObject({ status: 400 })
    expect(mockDeactivate).not.toHaveBeenCalled()
  })

  it('member removal of a member of another workspace is 404', async () => {
    mockFindById.mockResolvedValue({
      id: 'm-2',
      workspaceId: 'ws-other',
      role: 'MEMBER',
    })
    await expect(
      memberService.removeMember('m-2', OWNER, AUDIT)
    ).rejects.toMatchObject({ status: 404 })
    expect(mockDeactivate).not.toHaveBeenCalled()
  })

  it('member removal of an unknown or already removed member is 404', async () => {
    mockFindById.mockResolvedValue(null)
    await expect(
      memberService.removeMember('m-2', OWNER, AUDIT)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('member removal never leaves the workspace without an OWNER', async () => {
    mockFindById.mockResolvedValue({
      id: 'm-2',
      workspaceId: 'ws-1',
      role: 'OWNER',
    })
    mockCountOwners.mockResolvedValue(1)
    await expect(
      memberService.removeMember('m-2', OWNER, AUDIT)
    ).rejects.toMatchObject({ status: 400 })
    expect(mockDeactivate).not.toHaveBeenCalled()
    expect(mockRemoveIntegrations).not.toHaveBeenCalled()
  })

  it('member removal of another OWNER works when owners remain and is audited with the key count', async () => {
    mockFindById.mockResolvedValue({
      id: 'm-2',
      workspaceId: 'ws-1',
      role: 'OWNER',
    })
    mockCountOwners.mockResolvedValue(2)

    const result = await memberService.removeMember('m-2', OWNER, AUDIT)

    expect(result).toEqual({ apiKeysRevoked: 3 })
    expect(mockDeactivate).toHaveBeenCalledWith('m-2', 'REMOVED')
    // Personal integrations of this member in this workspace, same actor,
    // removed before the row is deactivated.
    expect(mockRemoveIntegrations).toHaveBeenCalledWith('ws-1', 'm-2', AUDIT)
    expect(mockRemoveIntegrations.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeactivate.mock.invocationCallOrder[0]!
    )
    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      action: 'member.removed',
      target: { type: 'member', id: 'm-2' },
      metadata: { role: 'OWNER', apiKeysRevoked: 3 },
      context: AUDIT,
    })
  })
})
