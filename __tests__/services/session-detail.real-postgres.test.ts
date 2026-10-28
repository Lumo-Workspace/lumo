/**
 * @jest-environment node
 *
 * LUM-946: who may open /sessions/[id], decided by sessionDetailService
 * against a REAL Postgres (PGlite) — the session's member or an OWNER of the
 * session's own workspace; everyone else gets null (the page's 404).
 */
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'
import {
  SESSION_ACCESS,
  VIEWER,
  seedSessionAccess,
} from '../../scripts/test-support/session-access-seed'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))

const mockLookupProfiles = jest.fn()
jest.mock('@/lib/auth/user-profiles', () => ({
  lookupUserProfiles: (...a: unknown[]) => mockLookupProfiles(...a),
}))

import { sessionDetailService } from '@/lib/services/session-detail.service'

jest.setTimeout(180_000)

beforeAll(async () => {
  await harness.start()
  await seedSessionAccess(harness)
})

afterAll(async () => {
  await harness.stop()
})

beforeEach(() => {
  mockLookupProfiles.mockReset()
  mockLookupProfiles.mockResolvedValue(
    new Map([[VIEWER.member, { name: 'Mia Member', email: 'mia@example.com' }]])
  )
})

const view = (sessionId: string, clerkId: string) =>
  sessionDetailService.getForViewer(sessionId, clerkId)

describe('session member', () => {
  it('session member sees their own session with no owner hint', async () => {
    const d = await view(SESSION_ACCESS.root, VIEWER.member)
    expect(d).toMatchObject({
      id: SESSION_ACCESS.root,
      cwd: '/repo',
      workspaceSlug: 'ws-a',
      isOwnSession: true,
      ownerName: null,
    })
    expect(mockLookupProfiles).not.toHaveBeenCalled()
  })
})

describe('workspace owner', () => {
  it('owner of the session workspace sees another members session and whose it is', async () => {
    const d = await view(SESSION_ACCESS.root, VIEWER.ownerA)
    expect(d).toMatchObject({
      id: SESSION_ACCESS.root,
      workspaceSlug: 'ws-a',
      isOwnSession: false,
      ownerName: 'Mia Member',
    })
    expect(mockLookupProfiles).toHaveBeenCalledWith([VIEWER.member])
  })

  it('owner hint falls back to email, then to no name', async () => {
    mockLookupProfiles.mockResolvedValueOnce(
      new Map([[VIEWER.member, { name: null, email: 'mia@example.com' }]])
    )
    expect((await view(SESSION_ACCESS.root, VIEWER.ownerA))?.ownerName).toBe(
      'mia@example.com'
    )
    mockLookupProfiles.mockRejectedValueOnce(new Error('clerk down'))
    const d = await view(SESSION_ACCESS.root, VIEWER.ownerA)
    expect(d?.isOwnSession).toBe(false)
    expect(d?.ownerName).toBeNull()
  })
})

describe('other member of the same workspace', () => {
  it('other member of the same workspace gets null', async () => {
    expect(await view(SESSION_ACCESS.root, VIEWER.otherMember)).toBeNull()
  })
})

describe('cross workspace', () => {
  it('owner of another workspace who is a plain member here gets null', async () => {
    expect(await view(SESSION_ACCESS.root, VIEWER.ownerBMemberA)).toBeNull()
  })

  it('owner of another workspace only gets null', async () => {
    expect(await view(SESSION_ACCESS.root, VIEWER.ownerBOnly)).toBeNull()
  })

  it('signed in non member gets null', async () => {
    expect(await view(SESSION_ACCESS.root, VIEWER.stranger)).toBeNull()
  })

  it('owner of workspace B still sees sessions of workspace B', async () => {
    expect(await view(SESSION_ACCESS.inB, VIEWER.ownerBOnly)).toMatchObject({
      id: SESSION_ACCESS.inB,
      workspaceSlug: 'ws-b',
      isOwnSession: false,
    })
  })

  it('missing session id gets null', async () => {
    expect(await view('no-such-session', VIEWER.ownerA)).toBeNull()
  })
})

describe('child session', () => {
  it('child session follows its parent family rule', async () => {
    expect(await view(SESSION_ACCESS.child, VIEWER.member)).toMatchObject({
      id: SESSION_ACCESS.child,
      isOwnSession: true,
    })
    expect(await view(SESSION_ACCESS.child, VIEWER.ownerA)).toMatchObject({
      id: SESSION_ACCESS.child,
      isOwnSession: false,
      ownerName: 'Mia Member',
    })
    expect(await view(SESSION_ACCESS.child, VIEWER.otherMember)).toBeNull()
    expect(await view(SESSION_ACCESS.child, VIEWER.ownerBMemberA)).toBeNull()
    expect(await view(SESSION_ACCESS.child, VIEWER.ownerBOnly)).toBeNull()
  })

  it('child whose parent family is in another workspace gets null', async () => {
    expect(await view(SESSION_ACCESS.strayChild, VIEWER.ownerA)).toBeNull()
    expect(await view(SESSION_ACCESS.strayChild, VIEWER.member)).toBeNull()
  })
})

describe('memberRepository.findRoleInWorkspace', () => {
  it('returns the membership in that workspace only', async () => {
    const { memberRepository } =
      await import('@/lib/repositories/member.repository')
    expect(
      await memberRepository.findRoleInWorkspace('wsB', VIEWER.ownerBMemberA)
    ).toEqual({ id: 'mB-owner', workspaceId: 'wsB', role: 'OWNER' })
    expect(
      await memberRepository.findRoleInWorkspace('wsA', VIEWER.ownerBMemberA)
    ).toEqual({ id: 'mA-ownerB', workspaceId: 'wsA', role: 'MEMBER' })
    expect(
      await memberRepository.findRoleInWorkspace('wsA', VIEWER.ownerBOnly)
    ).toBeNull()
  })
})
