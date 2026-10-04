/**
 * @jest-environment node
 *
 * LUM-907 — the workspace audit log against a REAL Postgres (every migration
 * replayed, so the hand-written migration is exercised too):
 *  - an instrumented service writes its event after the operation commits,
 *    redacted (IP validated, User-Agent and metadata credential-redacted);
 *  - an operation that fails leaves no event; an audit write that fails
 *    never blocks the operation;
 *  - the daily prune deletes only events past the 365-day retention;
 *  - deleting the workspace deletes its events and keeps the receipt;
 *  - the GDPR export pages the events.
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

import { logger } from '@/lib/logger'
import {
  pruneExpiredAuditEvents,
  recordAuditEvent,
} from '@/lib/services/audit.service'
import { AUDIT_RETENTION_DAYS } from '@/lib/audit/actions'
import { memberService } from '@/lib/services/member.service'
import { workspaceService } from '@/lib/services/workspace.service'
import { workspaceDeletionRepository } from '@/lib/repositories/workspace-deletion.repository'
import { workspaceExportRepository } from '@/lib/repositories/workspace-export.repository'
import { memberAuditContext } from '@/lib/api/audit-context'

jest.setTimeout(180_000)

const WS = 'ws_audit'
const OTHER_WS = 'ws_audit_other'
const OWNER = 'm_audit_owner'
const MEMBER = 'm_audit_member'
const DAY = 24 * 60 * 60 * 1000
// A credential shape the registry redacts (AWS access key id).
const AWS_KEY = ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('')

function headers(values: Record<string, string>) {
  return new Headers(values)
}

const ownerContext = () =>
  memberAuditContext(
    headers({
      'x-forwarded-for': '203.0.113.9, 10.0.0.1',
      'user-agent': `Mozilla/5.0 token=${AWS_KEY}`,
    }),
    { clerkId: 'clerk_owner', memberId: OWNER }
  )

async function events(workspaceId = WS) {
  return harness.prisma!.auditEvent.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'asc' },
  })
}

async function seedWorkspace(id: string, ownerId: string, memberId?: string) {
  const db = harness.prisma!
  await db.workspace.create({ data: { id, name: `WS ${id}`, slug: id } })
  await db.workspaceMember.create({
    data: {
      id: ownerId,
      workspaceId: id,
      clerkId: `clerk_${ownerId}`,
      role: 'OWNER',
    },
  })
  if (memberId) {
    await db.workspaceMember.create({
      data: {
        id: memberId,
        workspaceId: id,
        clerkId: `clerk_${memberId}`,
        role: 'MEMBER',
      },
    })
  }
}

beforeAll(async () => {
  await harness.start()
  await seedWorkspace(WS, OWNER, MEMBER)
  await seedWorkspace(OTHER_WS, 'm_other_owner')
})

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.prisma!.auditEvent.deleteMany({})
  jest.clearAllMocks()
})

describe('LUM-907 audit write', () => {
  it('LUM-907 audit infra: a role change writes one redacted member.role_changed event', async () => {
    await memberService.updateMemberRole(
      MEMBER,
      'OWNER',
      OWNER,
      'OWNER',
      WS,
      ownerContext()
    )

    const rows = await events()
    expect(rows).toHaveLength(1)
    const e = rows[0]!
    expect(e).toMatchObject({
      workspaceId: WS,
      actorType: 'MEMBER',
      actorId: 'clerk_owner',
      actorMemberId: OWNER,
      action: 'member.role_changed',
      targetType: 'member',
      targetId: MEMBER,
      source: 'WEB',
      ip: '203.0.113.9',
      metadata: { from: 'MEMBER', to: 'OWNER' },
    })
    expect(e.userAgent).toContain('Mozilla/5.0')
    expect(e.userAgent).not.toContain(AWS_KEY)
    // Restore for the other tests.
    await harness.prisma!.workspaceMember.update({
      where: { id: MEMBER },
      data: { role: 'MEMBER' },
    })
  })

  it('LUM-907 audit infra: metadata strings are credential-redacted before storage', async () => {
    const ok = await recordAuditEvent({
      workspaceId: WS,
      action: 'sentry.connected',
      target: { type: 'integration', id: 'sentry' },
      metadata: { orgSlug: `acme ${AWS_KEY}` },
      context: ownerContext(),
    })
    expect(ok).toBe(true)
    const [e] = await events()
    expect(JSON.stringify(e!.metadata)).not.toContain(AWS_KEY)
    expect(JSON.stringify(e!.metadata)).toContain('acme')
  })

  it('LUM-907 audit infra: a member actor given only a member id is resolved to its Clerk id', async () => {
    await recordAuditEvent({
      workspaceId: WS,
      action: 'session_raw_record.deleted',
      target: { type: 'session', id: 's1' },
      context: memberAuditContext(headers({}), { memberId: OWNER }, 'bearer'),
    })
    const [e] = await events()
    expect(e).toMatchObject({
      actorId: `clerk_${OWNER}`,
      actorMemberId: OWNER,
      source: 'CLI',
      ip: null,
      userAgent: null,
    })
  })

  it('LUM-907 audit infra: a settings change writes one event per changed category with from and to', async () => {
    await workspaceService.updateWorkspace(
      WS,
      'OWNER',
      WS,
      {
        name: 'Renamed',
        securityHuntEnabled: false,
        deadLetterRetentionDays: 30,
        summaryEnabled: true, // unchanged (default true) — not audited
      },
      ownerContext()
    )
    const rows = await events()
    expect(rows.map(r => r.action).sort()).toEqual([
      'workspace.retention_updated',
      'workspace.security_settings_updated',
      'workspace.settings_updated',
    ])
    const byAction = Object.fromEntries(rows.map(r => [r.action, r.metadata]))
    expect(byAction['workspace.settings_updated']).toEqual({
      changes: { name: { from: `WS ${WS}`, to: 'Renamed' } },
    })
    expect(byAction['workspace.security_settings_updated']).toEqual({
      changes: { securityHuntEnabled: { from: true, to: false } },
    })
    expect(byAction['workspace.retention_updated']).toEqual({
      changes: { deadLetterRetentionDays: { from: 7, to: 30 } },
    })
  })
})

describe('LUM-907 audit consistency with the main operation', () => {
  it('LUM-907 audit failure non-blocking: a failed audit insert does not block or roll back the operation', async () => {
    // An event for a workspace that does not exist violates the FK: the
    // insert fails, recordAuditEvent reports false and logs, never throws.
    const ok = await recordAuditEvent({
      workspaceId: 'ws_missing',
      action: 'member.left',
      target: { type: 'member', id: 'x' },
      context: ownerContext(),
    })
    expect(ok).toBe(false)
    expect(logger.error).toHaveBeenCalledWith(
      '[audit] write failed',
      expect.objectContaining({ action: 'member.left' })
    )
  })

  it('LUM-907 audit failure non-blocking: the operation commits even when every audit insert fails', async () => {
    const spy = jest
      .spyOn(harness.prisma!.auditEvent, 'create')
      .mockRejectedValue(new Error('audit table unavailable'))
    try {
      await expect(
        memberService.updateMemberRole(
          MEMBER,
          'OWNER',
          OWNER,
          'OWNER',
          WS,
          ownerContext()
        )
      ).resolves.toBeTruthy()
    } finally {
      spy.mockRestore()
    }
    const member = await harness.prisma!.workspaceMember.findUnique({
      where: { id: MEMBER },
      select: { role: true },
    })
    expect(member?.role).toBe('OWNER')
    expect(logger.error).toHaveBeenCalledWith(
      '[audit] write failed',
      expect.objectContaining({ action: 'member.role_changed' })
    )
    await harness.prisma!.workspaceMember.update({
      where: { id: MEMBER },
      data: { role: 'MEMBER' },
    })
  })

  it('LUM-907 audit failure non-blocking: an operation that fails leaves no audit event', async () => {
    // Demoting the only OWNER is refused before anything is written.
    await expect(
      memberService.updateMemberRole(
        OWNER,
        'MEMBER',
        MEMBER,
        'OWNER',
        WS,
        ownerContext()
      )
    ).rejects.toMatchObject({ status: 400 })
    expect(await events()).toHaveLength(0)
  })
})

describe('LUM-907 audit retention prune', () => {
  it('LUM-907 audit prune: deletes only events older than the 365-day retention, in batches', async () => {
    expect(AUDIT_RETENTION_DAYS).toBe(365)
    const now = new Date('2027-06-01T00:00:00.000Z')
    const at = (days: number) => new Date(now.getTime() - days * DAY)
    const base = {
      workspaceId: WS,
      actorType: 'SYSTEM' as const,
      action: 'member.left',
      targetType: 'member',
      source: 'SYSTEM' as const,
    }
    await harness.prisma!.auditEvent.createMany({
      data: [
        { ...base, id: 'old_1', createdAt: at(400) },
        { ...base, id: 'old_2', createdAt: at(366) },
        { ...base, id: 'old_3', createdAt: at(365.5) },
        { ...base, id: 'keep_1', createdAt: at(364) },
        { ...base, id: 'keep_2', createdAt: at(1) },
      ],
    })

    const first = await pruneExpiredAuditEvents(now, {
      batchSize: 2,
      maxBatches: 1,
    })
    expect(first).toMatchObject({ deleted: 2, done: false })
    const second = await pruneExpiredAuditEvents(now, {
      batchSize: 2,
      maxBatches: 5,
    })
    expect(second).toMatchObject({ deleted: 1, done: true })

    const left = (await events()).map(e => e.id).sort()
    expect(left).toEqual(['keep_1', 'keep_2'])
  })
})

describe('LUM-907 audit with workspace deletion and export', () => {
  it('LUM-907 audit export: the GDPR export pages the workspace audit events and no other workspace', async () => {
    await recordAuditEvent({
      workspaceId: WS,
      action: 'data_export.requested',
      target: { type: 'data_export', id: 'exp_1' },
      context: ownerContext(),
    })
    await recordAuditEvent({
      workspaceId: OTHER_WS,
      action: 'data_export.requested',
      target: { type: 'data_export', id: 'exp_2' },
      context: ownerContext(),
    })
    const rows = await workspaceExportRepository.pageRows(
      'audit-events',
      WS,
      null,
      100
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      action: 'data_export.requested',
      targetId: 'exp_1',
      ip: '203.0.113.9',
    })
    expect(rows[0]).not.toHaveProperty('workspaceId')
  })

  it('LUM-907 audit workspace deletion: deleting the workspace deletes its audit events and keeps the receipt', async () => {
    await recordAuditEvent({
      workspaceId: OTHER_WS,
      action: 'workspace.deletion_scheduled',
      target: { type: 'workspace', id: OTHER_WS },
      context: ownerContext(),
    })
    await recordAuditEvent({
      workspaceId: WS,
      action: 'member.left',
      target: { type: 'member', id: 'x' },
      context: ownerContext(),
    })
    expect(await events(OTHER_WS)).toHaveLength(1)

    const out = await workspaceDeletionRepository.purge(
      OTHER_WS,
      'clerk_m_other_owner'
    )

    expect(out?.rowCounts).toMatchObject({ AuditEvent: 1 })
    expect(await events(OTHER_WS)).toHaveLength(0)
    // Another workspace's events are untouched.
    expect(await events(WS)).toHaveLength(1)
    const receipt = await harness.prisma!.workspaceDeletionReceipt.findUnique({
      where: { id: out!.receiptId },
      select: { workspaceId: true },
    })
    expect(receipt).toEqual({ workspaceId: OTHER_WS })
  })
})
