/**
 * @jest-environment node
 *
 * LUM-919 — the subprocessor change notice against a REAL Postgres (every
 * migration replayed, the hand-written one included) with a MOCKED email
 * client: nothing here can reach Resend or Clerk.
 *  - recipients: every active OWNER of every workspace; deactivated owners,
 *    plain members and purged workspaces excluded; a workspace scheduled for
 *    deletion still notified;
 *  - dry run sends and writes nothing;
 *  - --confirm sends once per owner per workspace, records it, writes a
 *    SYSTEM audit event; a rerun sends nothing; a failed send is retried;
 *  - a change under 30 days without urgent, or a removal, is refused;
 *  - the email: plain, English, change + date + /security link + objection.
 */
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

import type { SubprocessorChange } from '@/lib/legal/subprocessor-changes'
import { AI_HOST_SUBPROCESSORS } from '@/lib/legal/subprocessors'
import {
  findSubprocessorChange,
  planSubprocessorNotice,
  renderSubprocessorNotice,
  sendSubprocessorNotice,
  type NoticeDeps,
  type NoticeMessage,
} from '@/lib/services/subprocessor-notice.service'
import { subprocessorNoticeRepository } from '@/lib/repositories/subprocessor-notice.repository'

jest.setTimeout(180_000)

const NOW = new Date('2026-11-01T09:00:00Z')
const ADDED: SubprocessorChange = {
  id: '2026-11-01-example-host',
  kind: 'added',
  announcedAt: '2026-11-01',
  effectiveAt: '2026-12-05',
  summary: 'Example Host, Inc. joins the AI model hosts (routed globally).',
  after: {
    list: 'aiHost',
    entry: {
      gatewaySlug: 'examplehost',
      entity: 'Example Host, Inc.',
      location: 'globalRouting',
    },
  },
}
const SHORT: SubprocessorChange = {
  ...ADDED,
  id: '2026-11-01-short-notice',
  effectiveAt: '2026-11-20',
}
const URGENT: SubprocessorChange = {
  ...SHORT,
  id: '2026-11-01-urgent',
  urgent: {
    reason: 'The current host lost its zero data retention agreement.',
  },
}
const REMOVED: SubprocessorChange = {
  id: '2026-11-01-wafer-removed',
  kind: 'removed',
  announcedAt: '2026-11-01',
  effectiveAt: '2026-11-01',
  summary: 'Wafer no longer hosts Lumo models.',
  before: {
    list: 'aiHost',
    entry: AI_HOST_SUBPROCESSORS[AI_HOST_SUBPROCESSORS.length - 1]!,
  },
}
const CHANGES = [ADDED, SHORT, URGENT, REMOVED]

/** Clerk id → email; `clerk_noemail` has none. */
const EMAILS: Record<string, string> = {
  clerk_a1: 'a1@example.com',
  clerk_a2: 'a2@example.com',
  clerk_a_gone: 'gone@example.com',
  clerk_a_member: 'member@example.com',
  clerk_b1: 'b1@example.com',
  clerk_d1: 'd1@example.com',
}

const sent: NoticeMessage[] = []
const sendEmail = jest.fn(async (m: NoticeMessage) => {
  sent.push(m)
  return { messageId: `msg_${sent.length}` }
})
const lookupEmails = jest.fn(async (ids: readonly string[]) => {
  return new Map(ids.map(id => [id, EMAILS[id] ?? null]))
})
const deps: NoticeDeps = { sendEmail, lookupEmails, now: NOW, changes: CHANGES }

async function seed() {
  const db = harness.prisma!
  const ws = async (id: string, name: string, extra = {}) =>
    db.workspace.create({ data: { id, name, slug: id, ...extra } })
  const member = async (
    id: string,
    workspaceId: string,
    role: 'OWNER' | 'MEMBER',
    deactivatedAt: Date | null = null
  ) =>
    db.workspaceMember.create({
      data: { id, workspaceId, clerkId: `clerk_${id}`, role, deactivatedAt },
    })
  await ws('ws_a', 'Acme <Corp>')
  await member('a1', 'ws_a', 'OWNER')
  await member('a2', 'ws_a', 'OWNER')
  await member('a_gone', 'ws_a', 'OWNER', new Date('2026-10-01'))
  await member('a_member', 'ws_a', 'MEMBER')
  await ws('ws_b', 'Beta', {
    deletionRequestedAt: new Date('2026-10-31T00:00:00Z'),
    deletionExecuteAt: new Date('2026-11-02T00:00:00Z'),
    deletionRequestedByClerkId: 'clerk_b1',
  })
  await member('b1', 'ws_b', 'OWNER')
  await ws('ws_c', 'Gamma (no owner email)')
  await member('noemail', 'ws_c', 'OWNER')
  // A workspace that is purged before the run: no rows, so no recipient.
  await ws('ws_d', 'Deleted')
  await member('d1', 'ws_d', 'OWNER')
  await db.workspace.delete({ where: { id: 'ws_d' } })
}

beforeAll(async () => {
  await harness.start()
  await seed()
})

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.prisma!.subprocessorNoticeDelivery.deleteMany({})
  await harness.prisma!.auditEvent.deleteMany({})
  sent.length = 0
  jest.clearAllMocks()
})

describe('subprocessor change notice recipients (LUM-919)', () => {
  it('lists active owners of every remaining workspace only', async () => {
    const rows = await subprocessorNoticeRepository.listWorkspacesWithOwners()
    expect(
      rows.map(w => [
        w.id,
        w.owners.map(o => o.clerkId),
        !!w.deletionRequestedAt,
      ])
    ).toEqual([
      ['ws_a', ['clerk_a1', 'clerk_a2'], false],
      ['ws_b', ['clerk_b1'], true],
      ['ws_c', ['clerk_noemail'], false],
    ])
  })

  it('records a delivery once; a duplicate is not an error', async () => {
    const d = {
      changeId: ADDED.id,
      workspaceId: 'ws_a',
      clerkId: 'clerk_a1',
      messageId: 'm1',
    }
    await subprocessorNoticeRepository.recordDelivery(d)
    await subprocessorNoticeRepository.recordDelivery(d)
    expect(await subprocessorNoticeRepository.listDelivered(ADDED.id)).toEqual(
      new Set(['ws_a:clerk_a1'])
    )
  })
})

describe('subprocessor change notice dry run (LUM-919)', () => {
  it('dry run counts owners per workspace, renders the email and sends nothing', async () => {
    const plan = await planSubprocessorNotice(ADDED.id, deps)
    expect(plan.refusal).toBeNull()
    expect(plan.totals).toEqual({
      workspaces: 3,
      owners: 4,
      alreadyNotified: 0,
      toNotify: 4,
      missingEmail: 1,
    })
    expect(
      plan.workspaces.map(w => [w.workspaceId, w.toNotify, w.pendingDeletion])
    ).toEqual([
      ['ws_a', 2, false],
      ['ws_b', 1, true],
      ['ws_c', 1, false],
    ])
    expect(plan.preview.subject).toBe(
      'Subprocessor change for Acme <Corp>, effective 5 December 2026'
    )
    expect(sendEmail).not.toHaveBeenCalled()
    expect(await harness.prisma!.subprocessorNoticeDelivery.count()).toBe(0)
    expect(await harness.prisma!.auditEvent.count()).toBe(0)
  })

  it('dry run reports a refusal for a change under 30 days', async () => {
    const plan = await planSubprocessorNotice(SHORT.id, deps)
    expect(plan.refusal).toMatch(/needs 30 days of notice/)
  })
})

describe('subprocessor change notice send (LUM-919)', () => {
  it('sends once to each active owner, records it and audits each workspace', async () => {
    const result = await sendSubprocessorNotice(ADDED.id, deps)
    expect(result).toEqual({
      changeId: ADDED.id,
      sent: 3,
      alreadyNotified: 0,
      failed: [
        { workspaceId: 'ws_c', clerkId: 'clerk_noemail', reason: 'no email' },
      ],
      unrecorded: [],
      workspacesNotified: 2,
    })
    expect(sent.map(m => m.to).sort()).toEqual([
      'a1@example.com',
      'a2@example.com',
      'b1@example.com',
    ])
    expect(sent.map(m => m.idempotencyKey)).toContain(
      `subprocessor-change/${ADDED.id}/ws_a/clerk_a1`
    )
    expect(await subprocessorNoticeRepository.listDelivered(ADDED.id)).toEqual(
      new Set(['ws_a:clerk_a1', 'ws_a:clerk_a2', 'ws_b:clerk_b1'])
    )

    const audit = await harness.prisma!.auditEvent.findMany({
      orderBy: { workspaceId: 'asc' },
    })
    expect(audit.map(e => e.workspaceId)).toEqual(['ws_a', 'ws_b'])
    expect(audit[0]).toMatchObject({
      actorType: 'SYSTEM',
      actorId: null,
      source: 'SYSTEM',
      action: 'subprocessor_change.notified',
      targetType: 'subprocessor_change',
      targetId: ADDED.id,
      metadata: {
        kind: 'added',
        effectiveAt: '2026-12-05',
        urgent: false,
        ownersNotified: 2,
        ownersFailed: 0,
      },
    })
  })

  it('a rerun sends nothing to owners already notified', async () => {
    await sendSubprocessorNotice(ADDED.id, deps)
    sendEmail.mockClear()
    const again = await sendSubprocessorNotice(ADDED.id, deps)
    expect(again.sent).toBe(0)
    expect(again.alreadyNotified).toBe(3)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(await harness.prisma!.subprocessorNoticeDelivery.count()).toBe(3)
    const plan = await planSubprocessorNotice(ADDED.id, deps)
    expect(plan.totals.toNotify).toBe(1) // only the owner with no email
  })

  it('a failed send is not recorded and the next run retries it', async () => {
    sendEmail.mockImplementationOnce(async () => {
      throw new Error('validation_error: rejected')
    })
    const first = await sendSubprocessorNotice(ADDED.id, deps)
    expect(first.sent).toBe(2)
    expect(first.failed).toHaveLength(2)
    sendEmail.mockClear()
    const second = await sendSubprocessorNotice(ADDED.id, deps)
    expect(second.sent).toBe(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('a send whose record fails counts as sent and is reported, not as a send failure', async () => {
    const spy = jest
      .spyOn(subprocessorNoticeRepository, 'recordDelivery')
      .mockRejectedValueOnce(new Error('connection reset'))
    try {
      const result = await sendSubprocessorNotice(ADDED.id, deps)
      expect(result.sent).toBe(3)
      expect(result.failed).toEqual([
        { workspaceId: 'ws_c', clerkId: 'clerk_noemail', reason: 'no email' },
      ])
      expect(result.unrecorded).toEqual([
        {
          workspaceId: 'ws_a',
          clerkId: 'clerk_a1',
          reason: 'connection reset',
        },
      ])
      expect(
        await subprocessorNoticeRepository.listDelivered(ADDED.id)
      ).toEqual(new Set(['ws_a:clerk_a2', 'ws_b:clerk_b1']))
    } finally {
      spy.mockRestore()
    }
  })

  it('refuses a change under 30 days that is not urgent, and a removal', async () => {
    await expect(sendSubprocessorNotice(SHORT.id, deps)).rejects.toMatchObject({
      status: 409,
    })
    await expect(
      sendSubprocessorNotice(REMOVED.id, deps)
    ).rejects.toMatchObject({ status: 409 })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(await harness.prisma!.subprocessorNoticeDelivery.count()).toBe(0)
  })

  it('sends an urgent change under 30 days, saying why', async () => {
    const result = await sendSubprocessorNotice(URGENT.id, deps)
    expect(result.sent).toBe(3)
    expect(sent[0]!.subject).toMatch(/^Urgent subprocessor change/)
    expect(sent[0]!.text).toContain(URGENT.urgent!.reason)
  })

  it('an urgent change sent with the full notice is not called urgent', () => {
    const calm = renderSubprocessorNotice(
      { ...ADDED, urgent: { reason: 'Precaution.' } },
      'Acme',
      NOW
    )
    expect(calm.subject).toMatch(/^Subprocessor change/)
    expect(calm.text).not.toContain('urgently')
    const rushed = renderSubprocessorNotice(URGENT, 'Acme', NOW)
    expect(rushed.subject).toMatch(/^Urgent subprocessor change/)
    expect(rushed.text).toContain("less than 30 days' notice")
  })

  it('an unknown change id is a 404', () => {
    expect(() => findSubprocessorChange('nope', CHANGES)).toThrow(
      expect.objectContaining({ status: 404 })
    )
    expect(findSubprocessorChange(ADDED.id, CHANGES)).toBe(ADDED)
  })
})

describe('subprocessor change notice email (LUM-919)', () => {
  it('states the change, date, /security link and objection route, with no tracking', () => {
    const { subject, html, text } = renderSubprocessorNotice(
      ADDED,
      'Acme <Corp>',
      NOW
    )
    expect(subject).toBe(
      'Subprocessor change for Acme <Corp>, effective 5 December 2026'
    )
    for (const part of [
      'New subprocessor: Example Host, Inc. joins the AI model hosts',
      'Takes effect: 5 December 2026 (00:00 UTC)',
      'https://www.uselumo.ai/security#subprocessor-changes',
      'write to privacy@uselumo.ai before 5 December 2026',
      'section 7.3 of our Data Processing Agreement',
      'you are an owner of this workspace',
    ])
      expect(text).toContain(part)
    expect(html).toContain('Acme &lt;Corp&gt;')
    expect(html).not.toContain('Acme <Corp>')
    expect(html).not.toMatch(/<img/i)
    expect((html.match(/<a /g) ?? []).length).toBe(1)
  })
})
