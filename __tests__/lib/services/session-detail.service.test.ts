/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/auth/user-profiles', () => ({
  lookupUserProfiles: jest.fn(),
}))

import { canViewSessionDetail } from '@/lib/services/session-detail.service'

const session = { workspaceId: 'wsA', workspaceMemberId: 'm-own' }

describe('canViewSessionDetail (LUM-946)', () => {
  it('allows the session member', () => {
    expect(
      canViewSessionDetail(session, {
        id: 'm-own',
        workspaceId: 'wsA',
        role: 'MEMBER',
      })
    ).toBe(true)
  })

  it('allows an OWNER of the session workspace', () => {
    expect(
      canViewSessionDetail(session, {
        id: 'm-owner',
        workspaceId: 'wsA',
        role: 'OWNER',
      })
    ).toBe(true)
  })

  it('denies another MEMBER of the session workspace', () => {
    expect(
      canViewSessionDetail(session, {
        id: 'm-other',
        workspaceId: 'wsA',
        role: 'MEMBER',
      })
    ).toBe(false)
  })

  it('denies an OWNER membership in a different workspace', () => {
    expect(
      canViewSessionDetail(session, {
        id: 'm-owner-b',
        workspaceId: 'wsB',
        role: 'OWNER',
      })
    ).toBe(false)
  })

  it('denies a viewer with no membership', () => {
    expect(canViewSessionDetail(session, null)).toBe(false)
  })
})
