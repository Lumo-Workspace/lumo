/**
 * @jest-environment node
 *
 * LUM-907 PR2 — the audit log query against a REAL Postgres (every
 * migration replayed): workspace isolation, the OWNER gate on the member's
 * stored role, keyset pagination that neither skips nor repeats rows (ties
 * on createdAt included), each filter, and the CSV export.
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
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))
jest.mock('@/lib/auth/user-profiles', () => ({
  lookupUserProfiles: jest.fn(
    async (ids: string[]) =>
      new Map(
        ids.map(id => [id, { name: `Name ${id}`, email: `${id}@example.com` }])
      )
  ),
}))

import {
  exportAuditEventsCsv,
  listAuditEvents,
} from '@/lib/services/audit-query.service'

jest.setTimeout(180_000)

const WS = 'ws_q'
const OTHER = 'ws_q_other'
const NOW = new Date('2026-10-04T12:00:00.000Z')
const owner = {
  workspaceId: WS,
  memberId: 'm_q_owner',
  clerkId: 'user_q_owner',
}
const member = {
  workspaceId: WS,
  memberId: 'm_q_member',
  clerkId: 'user_q_member',
}
const otherOwner = {
  workspaceId: OTHER,
  memberId: 'm_o_owner',
  clerkId: 'user_o_owner',
}

const at = (minutesAgo: number) =>
  new Date(NOW.getTime() - minutesAgo * 60 * 1000)

beforeAll(async () => {
  await harness.start()
  const db = harness.prisma!
  for (const [id, m] of [
    [WS, [owner, member]],
    [OTHER, [otherOwner]],
  ] as const) {
    await db.workspace.create({ data: { id, name: id, slug: id } })
    for (const x of m) {
      await db.workspaceMember.create({
        data: {
          id: x.memberId,
          workspaceId: id,
          clerkId: x.clerkId,
          role: x === member ? 'MEMBER' : 'OWNER',
        },
      })
    }
  }
  const base = {
    actorType: 'MEMBER' as const,
    source: 'WEB' as const,
    ip: '203.0.113.9',
  }
  await db.auditEvent.createMany({
    data: [
      // Three events sharing one timestamp: the keyset must tie-break on id.
      ...['ev_a', 'ev_b', 'ev_c'].map(id => ({
        ...base,
        id,
        workspaceId: WS,
        actorId: owner.clerkId,
        actorMemberId: owner.memberId,
        action: 'invite.created',
        targetType: 'invite',
        targetId: `inv_${id}`,
        createdAt: at(10),
      })),
      {
        ...base,
        id: 'ev_d',
        workspaceId: WS,
        actorId: member.clerkId,
        actorMemberId: member.memberId,
        action: 'member.left',
        targetType: 'member',
        targetId: member.memberId,
        createdAt: at(60 * 24 * 3),
        userAgent: '=HYPERLINK("http://evil")',
      },
      {
        id: 'ev_e',
        workspaceId: WS,
        actorType: 'SYSTEM',
        actorId: null,
        actorMemberId: null,
        action: 'github_app.uninstalled',
        targetType: 'integration',
        targetId: 'gh_1',
        source: 'SYSTEM',
        createdAt: at(60 * 24 * 10),
      },
      {
        ...base,
        id: 'ev_other',
        workspaceId: OTHER,
        actorId: otherOwner.clerkId,
        actorMemberId: otherOwner.memberId,
        action: 'invite.created',
        targetType: 'invite',
        targetId: 'inv_other',
        createdAt: at(5),
      },
    ],
  })
})

afterAll(async () => {
  await harness.stop()
})

describe('LUM-907 audit query on real Postgres', () => {
  it('audit query isolation: an owner sees only their workspace, newest first', async () => {
    const page = await listAuditEvents(owner, {}, NOW)
    expect(page.events.map(e => e.id)).toEqual([
      'ev_c',
      'ev_b',
      'ev_a',
      'ev_d',
      'ev_e',
    ])
    expect(page.nextCursor).toBeNull()
    const other = await listAuditEvents(otherOwner, {}, NOW)
    expect(other.events.map(e => e.id)).toEqual(['ev_other'])
    // Filtering by another workspace's target id finds nothing.
    const cross = await listAuditEvents(owner, { targetId: 'inv_other' }, NOW)
    expect(cross.events).toEqual([])
  })

  it('audit query isolation: a MEMBER of the workspace is refused with 403', async () => {
    await expect(listAuditEvents(member, {}, NOW)).rejects.toMatchObject({
      status: 403,
    })
    await expect(exportAuditEventsCsv(member, {}, NOW)).rejects.toMatchObject({
      status: 403,
    })
  })

  it('audit query pagination: pages of 2 walk every event once, ties included', async () => {
    const seen: string[] = []
    let cursor: string | undefined
    for (let i = 0; i < 5; i++) {
      const page = await listAuditEvents(owner, { limit: 2, cursor }, NOW)
      seen.push(...page.events.map(e => e.id))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    expect(seen).toEqual(['ev_c', 'ev_b', 'ev_a', 'ev_d', 'ev_e'])
  })

  it('audit query filters: action area, actor, date range and target', async () => {
    const ids = async (q: Parameters<typeof listAuditEvents>[1]) =>
      (await listAuditEvents(owner, q, NOW)).events.map(e => e.id)
    expect(await ids({ action: 'invite' })).toEqual(['ev_c', 'ev_b', 'ev_a'])
    expect(await ids({ action: 'member.left' })).toEqual(['ev_d'])
    expect(await ids({ actor: 'system' })).toEqual(['ev_e'])
    expect(await ids({ actor: 'm_q_member' })).toEqual(['ev_d'])
    expect(await ids({ actor: 'me' })).toEqual(['ev_c', 'ev_b', 'ev_a'])
    expect(await ids({ since: '2d' })).toEqual(['ev_c', 'ev_b', 'ev_a'])
    expect(await ids({ since: '7d', until: '2026-10-02' })).toEqual(['ev_d'])
    expect(await ids({ targetType: 'integration', targetId: 'gh_1' })).toEqual([
      'ev_e',
    ])
  })

  it('audit CSV export: the filtered set with names, injection neutralised', async () => {
    const result = await exportAuditEventsCsv(owner, { action: 'member' }, NOW)
    expect(result).toMatchObject({ rowCount: 1, truncated: false })
    const [header, line] = result.csv.split('\r\n')
    expect(header).toContain('"actor_email"')
    expect(line).toContain('"member.left"')
    expect(line).toContain('"user_q_member@example.com"')
    expect(line).toContain(`"'=HYPERLINK(""http://evil"")"`)
    expect(result.csv).not.toContain('inv_other')
  })
})
