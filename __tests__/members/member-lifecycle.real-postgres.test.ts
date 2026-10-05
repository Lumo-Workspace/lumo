/**
 * @jest-environment node
 *
 * LUM-906 PR2 — member soft deactivation against a REAL Postgres (every
 * migration replayed into PGlite, so the new columns and the 11 RESTRICT
 * foreign keys to workspace_members are the real ones).
 *
 * The first case is the regression for the old 500: leaving a workspace
 * deleted the member row, which Postgres refused (P2003,
 * projects_createdByMemberId_fkey) for anyone who had created a project. It
 * fails on the pre-fix code and passes now.
 */
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))

import { memberService } from '@/lib/services/member.service'
import { memberDeprovisionService } from '@/lib/services/member-deprovision.service'
import { inviteService } from '@/lib/services/invite.service'
import { authService } from '@/lib/services/auth.service'
import { generateApiKey } from '@/lib/services/api-key.service'
import {
  WEBHOOK_AUDIT_CONTEXT,
  type AuditContext,
} from '@/lib/services/audit.service'
import { memberRepository } from '@/lib/repositories/member.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { requireWorkspaceMembership, resolveActiveMembership } from '@/lib/auth'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'

jest.setTimeout(180_000)

const WS = 'ws_lifecycle'
const SOLO_WS = 'ws_solo_owner'
const AUDIT: AuditContext = {
  actor: { type: 'MEMBER', clerkId: 'clerk_owner', memberId: 'm_owner' },
  source: 'WEB',
}

function db() {
  return harness.prisma!
}

async function seedMember(
  id: string,
  clerkId: string,
  role: 'OWNER' | 'MEMBER',
  workspaceId = WS
) {
  await db().workspaceMember.create({
    data: { id, workspaceId, clerkId, role },
  })
  await db().actor.create({
    data: { id: `actor_${id}`, workspaceId, type: 'HUMAN', memberId: id },
  })
  if (workspaceId === WS) {
    await db().teamMember.create({ data: { teamId: 'team_lc', memberId: id } })
  }
}

/** A live API key for the member; the token is generated at runtime. */
async function seedKey(memberId: string): Promise<string> {
  const { key, keyHash, keyPrefix } = generateApiKey()
  await db().apiKey.create({
    data: { workspaceMemberId: memberId, label: 'laptop', keyHash, keyPrefix },
  })
  return key
}

async function auditActions(workspaceId: string, memberId: string) {
  const rows = await db().auditEvent.findMany({
    where: { workspaceId, targetId: memberId },
    orderBy: { createdAt: 'asc' },
    select: { action: true, metadata: true, actorType: true, source: true },
  })
  return rows
}

beforeAll(async () => {
  await harness.start()
  await db().workspace.create({ data: { id: WS, name: WS, slug: WS } })
  await db().workspace.create({
    data: { id: SOLO_WS, name: SOLO_WS, slug: SOLO_WS },
  })
  await db().team.create({
    data: {
      id: 'team_lc',
      workspaceId: WS,
      name: 'Eng',
      identifier: 'LC',
      isDefault: true,
    },
  })
  await seedMember('m_owner', 'clerk_owner', 'OWNER')
  await seedMember('m_dev', 'clerk_dev', 'MEMBER')
  await seedMember('m_qa', 'clerk_qa', 'MEMBER')
  await seedMember('m_gone', 'clerk_gone', 'MEMBER')
  await seedMember('m_solo', 'clerk_gone', 'OWNER', SOLO_WS)
  // m_dev authored rows behind RESTRICT foreign keys, plus a session.
  await db().project.create({
    data: {
      id: 'proj_lc',
      workspaceId: WS,
      teamId: 'team_lc',
      createdByMemberId: 'm_dev',
      name: 'Billing',
    },
  })
  await harness.insert('sessions', {
    id: 'sess_dev',
    workspaceId: WS,
    workspaceMemberId: 'm_dev',
  })
})

afterAll(async () => {
  await harness.stop()
})

describe('LUM-906 member lifecycle (real Postgres)', () => {
  it('member leave deactivates a project creator instead of failing on the RESTRICT foreign key', async () => {
    const key = await seedKey('m_dev')
    expect(await authService.verifyApiKey(key)).not.toBeNull()

    await memberService.leaveWorkspace('m_dev', 'MEMBER', WS, AUDIT)

    const row = await db().workspaceMember.findUnique({
      where: { id: 'm_dev' },
      select: { deactivatedAt: true, deactivationReason: true },
    })
    expect(row?.deactivatedAt).toBeInstanceOf(Date)
    expect(row?.deactivationReason).toBe('LEFT')
    // Authorship and history survive.
    expect(
      await db().project.findUnique({
        where: { id: 'proj_lc' },
        select: { createdByMemberId: true },
      })
    ).toEqual({ createdByMemberId: 'm_dev' })
    expect(await db().session.count({ where: { id: 'sess_dev' } })).toBe(1)
    expect(await db().actor.count({ where: { memberId: 'm_dev' } })).toBe(1)
    // Keys die, team rows go, and every membership lookup ignores the row.
    expect(await authService.verifyApiKey(key)).toBeNull()
    expect(await db().teamMember.count({ where: { memberId: 'm_dev' } })).toBe(
      0
    )
    expect(
      await memberRepository.findByWorkspaceAndClerkId(WS, 'clerk_dev')
    ).toBeNull()
    expect(
      (await memberRepository.findByWorkspace(WS)).map(m => m.id)
    ).not.toContain('m_dev')
    expect(await memberRepository.findByClerkId('clerk_dev')).toEqual([])
    // The identity gates: session, bearer/hook and team access.
    expect(await resolveActiveMembership('clerk_dev', WS)).toEqual({
      active: null,
      count: 0,
    })
    const gate = await requireWorkspaceMembership(WS, 'clerk_dev')
    expect((gate as Response).status).toBe(403)
    expect(await miscRepository.findMemberIdForHook('clerk_dev', WS)).toBeNull()
    await expect(
      requireTeamMemberOrOwner(
        { clerkId: 'clerk_dev', workspaceId: WS },
        { workspaceId: WS, teamId: 'team_lc' }
      )
    ).rejects.toMatchObject({ status: 403 })
    const audit = await auditActions(WS, 'm_dev')
    expect(audit.map(a => a.action)).toEqual(['member.left'])
    expect(audit[0]!.metadata).toMatchObject({ apiKeysRevoked: 1 })
  })

  it('member removal by an OWNER deactivates the member, revokes keys and audits member.removed', async () => {
    const key = await seedKey('m_qa')

    const result = await memberService.removeMember(
      'm_qa',
      { memberId: 'm_owner', role: 'OWNER', workspaceId: WS },
      AUDIT
    )

    expect(result).toEqual({ apiKeysRevoked: 1 })
    expect(await authService.verifyApiKey(key)).toBeNull()
    const audit = await auditActions(WS, 'm_qa')
    expect(audit.map(a => a.action)).toEqual(['member.removed'])
    expect(audit[0]).toMatchObject({
      actorType: 'MEMBER',
      metadata: { role: 'MEMBER', apiKeysRevoked: 1 },
    })
    // Removing again: already gone → 404, nothing new audited.
    await expect(
      memberService.removeMember(
        'm_qa',
        { memberId: 'm_owner', role: 'OWNER', workspaceId: WS },
        AUDIT
      )
    ).rejects.toMatchObject({ status: 404 })
    expect((await auditActions(WS, 'm_qa')).length).toBe(1)
  })

  it('member key of a deactivated member is refused even if it was never revoked', async () => {
    const key = await seedKey('m_owner')
    await db().workspaceMember.update({
      where: { id: 'm_owner' },
      data: { deactivatedAt: new Date() },
    })
    expect(await authService.verifyApiKey(key)).toBeNull()
    await db().workspaceMember.update({
      where: { id: 'm_owner' },
      data: { deactivatedAt: null },
    })
    expect(await authService.verifyApiKey(key)).not.toBeNull()
  })

  it('member deprovisioning deactivates every workspace except where the user is the last OWNER', async () => {
    const memberKey = await seedKey('m_gone')
    const soloKey = await seedKey('m_solo')
    const trigger = {
      clerkUserId: 'clerk_gone',
      reason: 'CLERK_USER_BANNED' as const,
      webhookId: 'msg_lc_1',
    }

    const outcomes = await memberDeprovisionService.deprovisionClerkUser(
      trigger,
      WEBHOOK_AUDIT_CONTEXT
    )

    expect(outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memberId: 'm_gone', outcome: 'deactivated' }),
        expect.objectContaining({
          memberId: 'm_solo',
          outcome: 'last_owner_kept',
          apiKeysRevoked: 1,
        }),
      ])
    )
    expect(await authService.verifyApiKey(memberKey)).toBeNull()
    expect(await authService.verifyApiKey(soloKey)).toBeNull()
    expect(
      await memberRepository.findByWorkspaceAndClerkId(SOLO_WS, 'clerk_gone')
    ).not.toBeNull()
    const gone = await auditActions(WS, 'm_gone')
    expect(gone).toEqual([
      expect.objectContaining({
        action: 'member.deprovisioned',
        actorType: 'SYSTEM',
        source: 'WEBHOOK',
        metadata: expect.objectContaining({
          reason: 'CLERK_USER_BANNED',
          webhookId: 'msg_lc_1',
          apiKeysRevoked: 1,
        }),
      }),
    ])
    expect((await auditActions(SOLO_WS, 'm_solo')).map(a => a.action)).toEqual([
      'member.api_keys_revoked',
    ])

    // Redelivery of the same event changes nothing and audits nothing.
    const again = await memberDeprovisionService.deprovisionClerkUser(
      trigger,
      WEBHOOK_AUDIT_CONTEXT
    )
    expect(again).toEqual([
      expect.objectContaining({
        memberId: 'm_solo',
        outcome: 'last_owner_kept',
        apiKeysRevoked: 0,
      }),
    ])
    expect((await auditActions(WS, 'm_gone')).length).toBe(1)
    expect((await auditActions(SOLO_WS, 'm_solo')).length).toBe(1)
  })

  it('member re-invite reactivates the same row with its history', async () => {
    const invite = await db().workspaceInvite.create({
      data: {
        workspaceId: WS,
        email: 'dev@acme.test',
        inviterName: 'Owner',
        invitedById: 'm_owner',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })

    const result = await inviteService.acceptInvite(
      invite.token,
      'clerk_dev',
      ['dev@acme.test'],
      AUDIT
    )

    expect(result).toEqual({ workspaceSlug: WS, alreadyMember: false })
    const rows = await db().workspaceMember.findMany({
      where: { workspaceId: WS, clerkId: 'clerk_dev' },
      select: {
        id: true,
        role: true,
        deactivatedAt: true,
        deactivationReason: true,
      },
    })
    expect(rows).toEqual([
      {
        id: 'm_dev',
        role: 'MEMBER',
        deactivatedAt: null,
        deactivationReason: null,
      },
    ])
    expect(await db().actor.count({ where: { memberId: 'm_dev' } })).toBe(1)
    expect(
      await db().teamMember.count({
        where: { memberId: 'm_dev', teamId: 'team_lc' },
      })
    ).toBe(1)
    // The old key stays dead; the person needs a new one.
    expect(
      await db().apiKey.count({
        where: { workspaceMemberId: 'm_dev', revokedAt: null },
      })
    ).toBe(0)
  })
})
