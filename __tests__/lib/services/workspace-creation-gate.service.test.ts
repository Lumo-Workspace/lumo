/**
 * LUM-1344 — workspace-creation gate: flag, member / approved / invited
 * bypasses, and the ONBOARDING_BLOCKED waitlist upsert.
 */
jest.unmock('@/lib/services/workspace-creation-gate.service')
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findFirstByClerkId: jest.fn() },
}))
jest.mock('@/lib/repositories/invite.repository', () => ({
  inviteRepository: { findPendingByEmails: jest.fn() },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: {
    findApprovedWaitlistEntryByEmails: jest.fn(),
    upsertBlockedWaitlistEntry: jest.fn(),
  },
}))

import {
  isWorkspaceApprovalRequired,
  workspaceCreationGate,
} from '@/lib/services/workspace-creation-gate.service'
import { memberRepository } from '@/lib/repositories/member.repository'
import { inviteRepository } from '@/lib/repositories/invite.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'

const findMember = memberRepository.findFirstByClerkId as jest.Mock
const findInvites = inviteRepository.findPendingByEmails as jest.Mock
const findApproved =
  miscRepository.findApprovedWaitlistEntryByEmails as jest.Mock
const upsertBlocked = miscRepository.upsertBlockedWaitlistEntry as jest.Mock

const now = new Date('2026-10-30T00:00:00Z')
const input = {
  userId: 'u1',
  verifiedEmails: ['a@x.com', 'b@x.com'],
  primaryEmail: 'b@x.com',
  displayName: 'Ann',
  now,
}

describe('workspaceCreationGate', () => {
  const original = process.env.WORKSPACE_CREATION_REQUIRES_APPROVAL
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.WORKSPACE_CREATION_REQUIRES_APPROVAL = 'true'
    findMember.mockResolvedValue(null)
    findApproved.mockResolvedValue(null)
    findInvites.mockResolvedValue([])
    upsertBlocked.mockResolvedValue({ id: 'w1', status: 'PENDING' })
  })
  afterAll(() => {
    if (original === undefined)
      delete process.env.WORKSPACE_CREATION_REQUIRES_APPROVAL
    else process.env.WORKSPACE_CREATION_REQUIRES_APPROVAL = original
  })

  it('returns without any lookup when the flag is off', async () => {
    delete process.env.WORKSPACE_CREATION_REQUIRES_APPROVAL
    await expect(
      workspaceCreationGate.assertMayCreate(input)
    ).resolves.toBeUndefined()
    expect(findMember).not.toHaveBeenCalled()
    expect(findApproved).not.toHaveBeenCalled()
    expect(findInvites).not.toHaveBeenCalled()
    expect(upsertBlocked).not.toHaveBeenCalled()
  })

  it('passes an existing member of any workspace', async () => {
    findMember.mockResolvedValue({ id: 'm1' })
    await expect(
      workspaceCreationGate.assertMayCreate(input)
    ).resolves.toBeUndefined()
    expect(findMember).toHaveBeenCalledWith('u1')
    expect(upsertBlocked).not.toHaveBeenCalled()
  })

  it('passes when an approved entry matches a non-primary verified email, case-insensitively', async () => {
    findApproved.mockResolvedValue({ id: 'w9' })
    await expect(
      workspaceCreationGate.assertMayCreate({
        ...input,
        verifiedEmails: ['A@X.com', 'b@x.com'],
        primaryEmail: 'b@x.com',
      })
    ).resolves.toBeUndefined()
    expect(findApproved).toHaveBeenCalledWith(['a@x.com', 'b@x.com'])
    expect(upsertBlocked).not.toHaveBeenCalled()
  })

  it('passes on a PENDING unexpired workspace invite', async () => {
    findInvites.mockResolvedValue([{ id: 'i1' }])
    await expect(
      workspaceCreationGate.assertMayCreate(input)
    ).resolves.toBeUndefined()
    expect(findInvites).toHaveBeenCalledWith(['a@x.com', 'b@x.com'], now)
    expect(upsertBlocked).not.toHaveBeenCalled()
  })

  it('does not pass on an expired or ACCEPTED invite', async () => {
    findInvites.mockResolvedValue([])
    await expect(
      workspaceCreationGate.assertMayCreate(input)
    ).rejects.toMatchObject({
      status: 403,
    })
    expect(findInvites).toHaveBeenCalledWith(['a@x.com', 'b@x.com'], now)
  })

  it('refuses with 403 WORKSPACE_APPROVAL_REQUIRED and upserts an ONBOARDING_BLOCKED entry for the primary verified email', async () => {
    await expect(
      workspaceCreationGate.assertMayCreate(input)
    ).rejects.toMatchObject({
      status: 403,
      code: 'WORKSPACE_APPROVAL_REQUIRED',
    })
    expect(upsertBlocked).toHaveBeenCalledWith({
      email: 'b@x.com',
      name: 'Ann',
    })
  })

  it('falls back to the first verified email when the primary is not verified', async () => {
    await expect(
      workspaceCreationGate.assertMayCreate({
        ...input,
        primaryEmail: 'z@x.com',
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(upsertBlocked).toHaveBeenCalledWith({
      email: 'a@x.com',
      name: 'Ann',
    })
  })

  it('refuses without writing a waitlist row when no email is verified', async () => {
    await expect(
      workspaceCreationGate.assertMayCreate({
        ...input,
        verifiedEmails: [],
        primaryEmail: null,
      })
    ).rejects.toMatchObject({
      status: 403,
      code: 'WORKSPACE_APPROVAL_REQUIRED',
    })
    expect(upsertBlocked).not.toHaveBeenCalled()
  })
})

describe('isWorkspaceApprovalRequired', () => {
  const KEY = 'WORKSPACE_CREATION_REQUIRES_APPROVAL'
  it('is true for "true" and "1"', () => {
    expect(isWorkspaceApprovalRequired({ [KEY]: 'true' })).toBe(true)
    expect(isWorkspaceApprovalRequired({ [KEY]: '1' })).toBe(true)
  })
  it('is false for unset and "false"', () => {
    expect(isWorkspaceApprovalRequired({})).toBe(false)
    expect(isWorkspaceApprovalRequired({ [KEY]: 'false' })).toBe(false)
  })
})
