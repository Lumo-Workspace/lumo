/**
 * @jest-environment node
 *
 * LUM-907 — recordAuditEvent normalisation and failure handling, the prune
 * loop, the HTTP-layer context builder, the settings diff, and the cron
 * route (auth + vercel.json registration). Repository mocked; the real-DB
 * behaviour is in audit-events.real-postgres.test.ts.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { NextRequest } from 'next/server'

jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))
jest.mock('@/lib/repositories/audit-event.repository', () => ({
  auditEventRepository: {
    create: jest.fn(),
    deleteBatchOlderThan: jest.fn(),
    findMemberClerkId: jest.fn(),
  },
}))

import { logger } from '@/lib/logger'
import { auditEventRepository as repo } from '@/lib/repositories/audit-event.repository'
import {
  AUDIT_METADATA_MAX_CHARS,
  AUDIT_USER_AGENT_MAX_CHARS,
  auditService,
  normalizeAuditIp,
  normalizeAuditMetadata,
  normalizeAuditUserAgent,
  pruneExpiredAuditEvents,
  recordAuditEvent,
} from '@/lib/services/audit.service'
import { clientIpHeader, memberAuditContext } from '@/lib/api/audit-context'
import { diffWorkspaceSettings } from '@/lib/audit/workspace-settings'
import { AUDIT_ACTIONS, isAuditAction } from '@/lib/audit/actions'
import { GET as cronGET } from '@/app/api/cron/prune-audit-events/route'

const m = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as unknown as jest.Mock
const AWS_KEY = ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('')

beforeEach(() => {
  jest.clearAllMocks()
  m(repo.create).mockResolvedValue({ id: 'ae_1' })
})

describe('normalizeAuditIp', () => {
  it('takes the first forwarded hop and validates it', () => {
    expect(normalizeAuditIp('203.0.113.9, 10.0.0.1')).toBe('203.0.113.9')
    expect(normalizeAuditIp('2001:db8::1')).toBe('2001:db8::1')
    expect(normalizeAuditIp('[2001:db8::1]:443')).toBe('2001:db8::1')
    expect(normalizeAuditIp('198.51.100.7:8080')).toBe('198.51.100.7')
  })

  it('drops anything that is not an IP address', () => {
    expect(normalizeAuditIp(null)).toBeNull()
    expect(normalizeAuditIp('')).toBeNull()
    expect(normalizeAuditIp('unknown')).toBeNull()
    expect(normalizeAuditIp(`${AWS_KEY}`)).toBeNull()
    expect(normalizeAuditIp('<script>')).toBeNull()
  })
})

describe('normalizeAuditUserAgent', () => {
  it('redacts credentials, strips control characters and truncates', () => {
    const ua = normalizeAuditUserAgent(`curl/8.0\r\nkey=${AWS_KEY}`)!
    expect(ua).not.toContain(AWS_KEY)
    expect(ua).not.toMatch(/[\r\n]/)
    expect(ua.startsWith('curl/8.0 key=')).toBe(true)
    expect(normalizeAuditUserAgent('x'.repeat(2000))).toHaveLength(
      AUDIT_USER_AGENT_MAX_CHARS
    )
    expect(normalizeAuditUserAgent(null)).toBeNull()
    expect(normalizeAuditUserAgent('  ')).toBeNull()
  })
})

describe('normalizeAuditMetadata', () => {
  it('redacts credentials at any depth and serialises dates', () => {
    const out = normalizeAuditMetadata({
      a: { b: [`k=${AWS_KEY}`] },
      at: new Date('2026-10-04T00:00:00.000Z'),
      gone: undefined,
    }) as Record<string, unknown>
    expect(JSON.stringify(out)).not.toContain(AWS_KEY)
    expect(out.at).toBe('2026-10-04T00:00:00.000Z')
    expect(out).not.toHaveProperty('gone')
  })

  it('replaces oversized metadata with a stub and empty metadata with nothing', () => {
    const out = normalizeAuditMetadata({
      big: 'x'.repeat(AUDIT_METADATA_MAX_CHARS + 1),
    })
    expect(out).toEqual({ truncated: true, keys: ['big'] })
    expect(normalizeAuditMetadata({})).toBeUndefined()
    expect(normalizeAuditMetadata(undefined)).toBeUndefined()
  })
})

describe('recordAuditEvent', () => {
  it('LUM-907 audit infra: writes the normalised event', async () => {
    const ok = await recordAuditEvent({
      workspaceId: 'ws1',
      action: 'invite.revoked',
      target: { type: 'invite', id: 'inv1' },
      context: memberAuditContext(
        new Headers({
          'x-forwarded-for': '203.0.113.9',
          'user-agent': 'Mozilla/5.0',
        }),
        { clerkId: 'u1', memberId: 'm1' }
      ),
    })
    expect(ok).toBe(true)
    expect(repo.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      actorType: 'MEMBER',
      actorId: 'u1',
      actorMemberId: 'm1',
      action: 'invite.revoked',
      targetType: 'invite',
      targetId: 'inv1',
      source: 'WEB',
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0',
      metadata: undefined,
    })
    expect(repo.findMemberClerkId).not.toHaveBeenCalled()
  })

  it('resolves a member actor given only a member id', async () => {
    m(repo.findMemberClerkId).mockResolvedValue('u9')
    await recordAuditEvent({
      workspaceId: 'ws1',
      action: 'member.left',
      target: { type: 'member', id: 'm9' },
      context: { actor: { type: 'MEMBER', memberId: 'm9' }, source: 'CLI' },
    })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'u9', actorMemberId: 'm9' })
    )
  })

  it('records agent and system actors', async () => {
    await recordAuditEvent({
      workspaceId: 'ws1',
      action: 'slack.connected',
      target: { type: 'integration', id: 'slack' },
      context: { actor: { type: 'AGENT', actorId: 'act1' }, source: 'CLI' },
    })
    expect(repo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ actorType: 'AGENT', actorId: 'act1' })
    )
  })

  it('records a missing context as a SYSTEM event and warns', async () => {
    await recordAuditEvent({
      workspaceId: 'ws1',
      action: 'slack.connected',
      target: { type: 'integration' },
    })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'SYSTEM',
        actorId: null,
        source: 'SYSTEM',
        targetId: null,
      })
    )
    expect(logger.warn).toHaveBeenCalled()
  })

  it('LUM-907 audit failure non-blocking: a failing write resolves false and logs an error', async () => {
    m(repo.create).mockRejectedValue(new Error('db down'))
    await expect(
      recordAuditEvent({
        workspaceId: 'ws1',
        action: 'member.left',
        target: { type: 'member', id: 'm1' },
      })
    ).resolves.toBe(false)
    expect(logger.error).toHaveBeenCalledWith('[audit] write failed', {
      action: 'member.left',
      workspaceId: 'ws1',
      error: 'db down',
    })
  })

  it('LUM-907 audit failure non-blocking: a failing actor lookup does not throw', async () => {
    m(repo.findMemberClerkId).mockRejectedValue(new Error('lookup failed'))
    await expect(
      recordAuditEvent({
        workspaceId: 'ws1',
        action: 'member.left',
        target: { type: 'member', id: 'm1' },
        context: { actor: { type: 'MEMBER', memberId: 'm1' }, source: 'WEB' },
      })
    ).resolves.toBe(false)
  })
})

describe('pruneExpiredAuditEvents', () => {
  it('LUM-907 audit prune: uses a 365-day cutoff and stops when a batch comes back short', async () => {
    m(repo.deleteBatchOlderThan)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(3)
    const now = new Date('2027-01-01T00:00:00.000Z')
    const out = await pruneExpiredAuditEvents(now, {
      batchSize: 10,
      maxBatches: 5,
    })
    expect(out).toEqual({
      deleted: 13,
      done: true,
      cutoff: '2026-01-01T00:00:00.000Z',
    })
    expect(repo.deleteBatchOlderThan).toHaveBeenCalledTimes(2)
  })

  it('LUM-907 audit prune: reports done false when the batch budget runs out', async () => {
    m(repo.deleteBatchOlderThan).mockResolvedValue(10)
    const out = await auditService.pruneExpired(new Date(), {
      batchSize: 10,
      maxBatches: 3,
    })
    expect(out).toMatchObject({ deleted: 30, done: false })
  })
})

describe('prune-audit-events cron route', () => {
  const OLD = process.env.CRON_SECRET
  afterAll(() => {
    if (OLD === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = OLD
  })

  it('LUM-907 audit prune: the cron is registered daily in vercel.json and requires cron auth', async () => {
    const vercel = JSON.parse(
      readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')
    ) as { crons: { path: string; schedule: string }[] }
    const cron = vercel.crons.find(
      c => c.path === '/api/cron/prune-audit-events'
    )
    expect(cron?.schedule).toMatch(/^\d+ \d+ \* \* \*$/)

    process.env.CRON_SECRET = 's3cret'
    const denied = await cronGET(
      new NextRequest('https://x.test/api/cron/prune-audit-events')
    )
    expect(denied.status).toBe(401)
    expect(repo.deleteBatchOlderThan).not.toHaveBeenCalled()

    m(repo.deleteBatchOlderThan).mockResolvedValue(0)
    const ok = await cronGET(
      new NextRequest('https://x.test/api/cron/prune-audit-events', {
        headers: { authorization: 'Bearer s3cret' },
      })
    )
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ deleted: 0, done: true })
  })
})

describe('memberAuditContext', () => {
  it('maps a Clerk session to WEB and an API-key bearer to CLI', () => {
    const h = new Headers({ 'x-real-ip': '198.51.100.1', 'user-agent': 'ua' })
    expect(memberAuditContext(h, { clerkId: 'u1' })).toEqual({
      actor: { type: 'MEMBER', clerkId: 'u1', memberId: null },
      source: 'WEB',
      ip: '198.51.100.1',
      userAgent: 'ua',
    })
    expect(memberAuditContext(h, { memberId: 'm1' }, 'bearer').source).toBe(
      'CLI'
    )
  })

  // LUM-907 PR2 decision: x-real-ip is set by Vercel's edge; the first
  // x-forwarded-for hop can be supplied by the client itself.
  it('audit IP extraction: prefers x-real-ip over a spoofable first x-forwarded-for hop', () => {
    const h = new Headers({
      'x-forwarded-for': '6.6.6.6, 203.0.113.1',
      'x-real-ip': '198.51.100.1',
    })
    expect(clientIpHeader(h)).toBe('198.51.100.1')
    expect(memberAuditContext(h, {}).ip).toBe('198.51.100.1')
  })

  it('audit IP extraction: falls back to x-forwarded-for when x-real-ip is missing or invalid', () => {
    expect(
      clientIpHeader(
        new Headers({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1' })
      )
    ).toBe('203.0.113.1, 10.0.0.1')
    expect(
      clientIpHeader(
        new Headers({
          'x-real-ip': 'garbage',
          'x-forwarded-for': '203.0.113.2',
        })
      )
    ).toBe('203.0.113.2')
    expect(clientIpHeader(new Headers({ 'x-real-ip': 'garbage' }))).toBe(
      'garbage'
    )
    expect(clientIpHeader(new Headers())).toBeNull()
    // The stored value is still validated downstream.
    expect(
      normalizeAuditIp(clientIpHeader(new Headers({ 'x-real-ip': 'garbage' })))
    ).toBeNull()
  })
})

describe('diffWorkspaceSettings', () => {
  it('groups real changes by audit action and ignores unchanged or absent fields', () => {
    expect(
      diffWorkspaceSettings(
        {
          name: 'A',
          summaryEnabled: true,
          securityPolicy: null,
          hookEventRetentionDays: null,
        },
        {
          name: 'B',
          summaryEnabled: true,
          securityPolicy: { block: [] },
          hookEventRetentionSince: new Date(),
        }
      )
    ).toEqual([
      {
        action: 'workspace.settings_updated',
        changes: { name: { from: 'A', to: 'B' } },
      },
      {
        action: 'workspace.security_settings_updated',
        changes: { securityPolicy: { from: null, to: { block: [] } } },
      },
    ])
    expect(diffWorkspaceSettings({ name: 'A' }, { name: 'A' })).toEqual([])
  })
})

describe('audit action vocabulary', () => {
  it('keys are unique dotted names', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length)
    for (const a of AUDIT_ACTIONS) expect(a).toMatch(/^[a-z_]+\.[a-z_]+$/)
    expect(isAuditAction('member.left')).toBe(true)
    expect(isAuditAction('member.exploded')).toBe(false)
  })
})
