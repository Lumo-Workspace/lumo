/**
 * @jest-environment node
 *
 * LUM-907 PR2 — the audit log query surface: filter validation, keyset
 * cursors, date bounds, the CSV export (formula-injection neutralising,
 * bounded) and the OWNER-only service with actor resolution.
 */
const mockRepo = {
  listPage: jest.fn(),
  findWorkspaceMembers: jest.fn(),
  create: jest.fn(),
  findMemberClerkId: jest.fn(),
}
const mockRole = jest.fn()
const mockProfiles = jest.fn()

jest.mock('@/lib/repositories/audit-event.repository', () => ({
  get auditEventRepository() {
    return mockRepo
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberRoleById: (...a: unknown[]) => mockRole(...a) },
}))
jest.mock('@/lib/utils/clerk-helpers', () => ({
  lookupClerkProfiles: (...a: unknown[]) => mockProfiles(...a),
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import {
  AUDIT_EXPORT_MAX_ROWS,
  decodeAuditCursor,
  encodeAuditCursor,
  isAuditActionFilter,
  parseAuditDateBound,
} from '@/lib/audit/query'
import { AUDIT_CSV_COLUMNS, auditEventsToCsv, csvCell } from '@/lib/audit/csv'
import { auditEventQuerySchema } from '@/lib/validation/audit'
import {
  exportAuditEventsCsv,
  listAuditEvents,
} from '@/lib/services/audit-query.service'
import type { AuditEventView } from '@/lib/audit/query'

const NOW = new Date('2026-10-04T12:00:00.000Z')
const viewer = {
  workspaceId: 'ws_1',
  memberId: 'm_owner',
  clerkId: 'user_owner',
}

function row(i: number, extra: Record<string, unknown> = {}) {
  return {
    id: `ev_${String(i).padStart(6, '0')}`,
    createdAt: new Date(NOW.getTime() - i * 1000),
    action: 'member.role_changed',
    actorType: 'MEMBER',
    actorId: 'user_owner',
    actorMemberId: 'm_owner',
    source: 'WEB',
    targetType: 'member',
    targetId: 'm_2',
    ip: '203.0.113.9',
    userAgent: 'Mozilla/5.0',
    metadata: { from: 'MEMBER', to: 'OWNER' },
    ...extra,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRole.mockResolvedValue('OWNER')
  mockProfiles.mockResolvedValue(new Map())
  mockRepo.findWorkspaceMembers.mockResolvedValue([])
  mockRepo.listPage.mockResolvedValue([])
})

describe('LUM-907 audit query helpers', () => {
  it('audit query: a cursor round-trips and a forged one is rejected', () => {
    const at = new Date('2026-10-01T10:00:00.123Z')
    const c = encodeAuditCursor({ createdAt: at, id: 'ev_1' })
    expect(decodeAuditCursor(c)).toEqual({ createdAt: at, id: 'ev_1' })
    expect(decodeAuditCursor('not-a-cursor')).toBeNull()
    expect(
      decodeAuditCursor(Buffer.from('["nope","x"]').toString('base64url'))
    ).toBeNull()
  })

  it('audit query: since and until accept relative days, dates and date-times', () => {
    expect(parseAuditDateBound('7d', 'since', NOW)?.toISOString()).toBe(
      '2026-09-27T12:00:00.000Z'
    )
    expect(parseAuditDateBound('2026-10-01', 'since', NOW)?.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z'
    )
    // A date-only until covers that whole UTC day (exclusive next midnight).
    expect(parseAuditDateBound('2026-10-01', 'until', NOW)?.toISOString()).toBe(
      '2026-10-02T00:00:00.000Z'
    )
    expect(
      parseAuditDateBound('2026-10-01T08:00:00Z', 'until', NOW)?.toISOString()
    ).toBe('2026-10-01T08:00:00.001Z')
    expect(parseAuditDateBound('2026-02-30', 'since', NOW)).toBeNull()
    expect(parseAuditDateBound('yesterday', 'since', NOW)).toBeNull()
  })

  it('audit query: action filters take an exact key or an area', () => {
    expect(isAuditActionFilter('member.role_changed')).toBe(true)
    expect(isAuditActionFilter('invite')).toBe(true)
    expect(isAuditActionFilter('member.deleted')).toBe(false)
    expect(isAuditActionFilter('')).toBe(false)
  })

  it('audit query: the query schema validates filters and drops empty strings', () => {
    const ok = auditEventQuerySchema.safeParse({
      action: 'invite',
      actor: '',
      since: '7d',
      until: '2026-10-04',
      targetType: 'member',
      limit: '25',
    })
    expect(ok.success && ok.data).toEqual({
      action: 'invite',
      since: '7d',
      until: '2026-10-04',
      targetType: 'member',
      limit: 25,
    })
    expect(
      auditEventQuerySchema.safeParse({ action: 'drop.table' }).success
    ).toBe(false)
    expect(auditEventQuerySchema.safeParse({ since: 'soon' }).success).toBe(
      false
    )
    expect(auditEventQuerySchema.safeParse({ limit: '500' }).success).toBe(
      false
    )
    expect(
      auditEventQuerySchema.safeParse({ targetType: 'project' }).success
    ).toBe(false)
  })
})

describe('LUM-907 audit CSV export', () => {
  it('audit CSV: formula-looking cells are neutralised and every cell is quoted', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(
      `"'=HYPERLINK(""http://x"")"`
    )
    expect(csvCell('+1')).toBe(`"'+1"`)
    expect(csvCell('-2+3')).toBe(`"'-2+3"`)
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`)
    expect(csvCell('\tcmd')).toBe(`"'\tcmd"`)
    expect(csvCell('\rcmd')).toBe(`"'\rcmd"`)
    expect(csvCell('plain, with "quotes"\nand a newline')).toBe(
      '"plain, with ""quotes""\nand a newline"'
    )
    expect(csvCell(null)).toBe('""')
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"')
  })

  it('audit CSV: the document has a header row and one CRLF row per event', () => {
    const e: AuditEventView = {
      id: 'ev_1',
      createdAt: '2026-10-04T12:00:00.000Z',
      action: 'invite.created',
      actorType: 'MEMBER',
      actorId: 'user_1',
      actorMemberId: 'm_1',
      actorName: 'Alice',
      actorEmail: 'alice@example.com',
      source: 'WEB',
      targetType: 'invite',
      targetId: 'inv_1',
      ip: '203.0.113.9',
      userAgent: '=cmd|"/c calc"!A1',
      metadata: { email: '@evil' },
    }
    const csv = auditEventsToCsv([e])
    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(AUDIT_CSV_COLUMNS.map(c => `"${c}"`).join(','))
    expect(lines[1]).toContain(`"'=cmd|""/c calc""!A1"`)
    expect(lines[2]).toBe('')
  })
})

describe('LUM-907 audit query service', () => {
  it('audit query service: a MEMBER is refused with 403 before any read', async () => {
    mockRole.mockResolvedValue('MEMBER')
    await expect(listAuditEvents(viewer, {}, NOW)).rejects.toMatchObject({
      status: 403,
    })
    await expect(exportAuditEventsCsv(viewer, {}, NOW)).rejects.toMatchObject({
      status: 403,
    })
    expect(mockRepo.listPage).not.toHaveBeenCalled()
  })

  it('audit query service: lists the caller workspace only, with names and a next cursor', async () => {
    mockRepo.listPage.mockResolvedValue([row(1), row(2), row(3)])
    mockProfiles.mockResolvedValue(
      new Map([['user_owner', { name: 'Olive', email: 'olive@example.com' }]])
    )
    const page = await listAuditEvents(
      viewer,
      { limit: 2, action: 'member', since: '2026-10-01', until: '2026-10-03' },
      NOW
    )
    expect(mockRepo.listPage).toHaveBeenCalledWith(
      'ws_1',
      expect.objectContaining({
        action: 'member',
        since: new Date('2026-10-01T00:00:00.000Z'),
        before: new Date('2026-10-04T00:00:00.000Z'),
      }),
      null,
      3
    )
    expect(page.events.map(e => e.id)).toEqual(['ev_000001', 'ev_000002'])
    expect(page.events[0]).toMatchObject({
      actorName: 'Olive',
      actorEmail: 'olive@example.com',
      createdAt: row(1).createdAt.toISOString(),
    })
    expect(decodeAuditCursor(page.nextCursor!)).toEqual({
      createdAt: row(2).createdAt,
      id: 'ev_000002',
    })

    mockRepo.listPage.mockResolvedValue([row(4)])
    const last = await listAuditEvents(
      viewer,
      { limit: 2, cursor: page.nextCursor! },
      NOW
    )
    expect(mockRepo.listPage.mock.calls[1]![2]).toEqual({
      createdAt: row(2).createdAt,
      id: 'ev_000002',
    })
    expect(last.nextCursor).toBeNull()
  })

  it('audit query service: an invalid cursor is a 400', async () => {
    await expect(
      listAuditEvents(viewer, { cursor: 'garbage' }, NOW)
    ).rejects.toMatchObject({ status: 400 })
  })

  it('audit query service: a failed Clerk lookup still returns the events', async () => {
    mockRepo.listPage.mockResolvedValue([row(1)])
    mockProfiles.mockRejectedValue(new Error('clerk down'))
    const page = await listAuditEvents(viewer, {}, NOW)
    expect(page.events[0]).toMatchObject({
      actorId: 'user_owner',
      actorName: null,
    })
  })

  it('audit query service: actor refs resolve to me, system, member id, email, name or Clerk id', async () => {
    mockRepo.findWorkspaceMembers.mockResolvedValue([
      { id: 'm_a', clerkId: 'user_a' },
      { id: 'm_b', clerkId: 'user_b' },
      { id: 'm_c', clerkId: 'user_c' },
    ])
    mockProfiles.mockResolvedValue(
      new Map([
        ['user_a', { name: 'Alice', email: 'alice@example.com' }],
        ['user_b', { name: 'Bob', email: 'bob@example.com' }],
        ['user_c', { name: 'Bob', email: 'bob2@example.com' }],
      ])
    )
    const filtersFor = async (actor: string) => {
      mockRepo.listPage.mockClear()
      await listAuditEvents(viewer, { actor }, NOW)
      return mockRepo.listPage.mock.calls[0]![1]
    }
    expect(await filtersFor('me')).toMatchObject({
      actorType: 'MEMBER',
      actorId: 'user_owner',
    })
    expect(await filtersFor('SYSTEM')).toMatchObject({ actorType: 'SYSTEM' })
    expect(await filtersFor('m_b')).toMatchObject({ actorId: 'user_b' })
    expect(await filtersFor('Alice@Example.com')).toMatchObject({
      actorId: 'user_a',
    })
    expect(await filtersFor('alice')).toMatchObject({ actorId: 'user_a' })
    expect(await filtersFor('user_gone')).toMatchObject({
      actorId: 'user_gone',
    })
    await expect(
      listAuditEvents(viewer, { actor: 'Bob' }, NOW)
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      listAuditEvents(viewer, { actor: 'nobody@example.com' }, NOW)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('audit CSV export: bounded at the row cap, newest first, flagged as truncated', async () => {
    const total = AUDIT_EXPORT_MAX_ROWS + 5
    const all = Array.from({ length: total }, (_, i) => row(i))
    mockRepo.listPage.mockImplementation(
      async (
        _ws: string,
        _f: unknown,
        cursor: { id: string } | null,
        take: number
      ) => {
        const start = cursor ? all.findIndex(r => r.id === cursor.id) + 1 : 0
        return all.slice(start, start + take)
      }
    )
    const result = await exportAuditEventsCsv(
      viewer,
      { cursor: 'ignored', limit: 1 },
      NOW
    )
    expect(result.rowCount).toBe(AUDIT_EXPORT_MAX_ROWS)
    expect(result.truncated).toBe(true)
    const lines = result.csv.trimEnd().split('\r\n')
    expect(lines).toHaveLength(AUDIT_EXPORT_MAX_ROWS + 1)
    expect(lines[1]).toContain(row(0).createdAt.toISOString())
    // Every read is scoped to the caller's workspace.
    expect(mockRepo.listPage.mock.calls.every(c => c[0] === 'ws_1')).toBe(true)
  })

  it('audit CSV export: a small log is complete and not truncated', async () => {
    mockRepo.listPage.mockResolvedValue([row(1), row(2)])
    const result = await exportAuditEventsCsv(viewer, {}, NOW)
    expect(result).toMatchObject({ rowCount: 2, truncated: false })
  })

  it('audit export audited: a CSV export writes audit_log.exported with the filters; a page read writes nothing', async () => {
    mockRepo.listPage.mockResolvedValue([row(1), row(2)])
    mockRepo.create.mockClear()
    await listAuditEvents(viewer, {}, NOW)
    expect(mockRepo.create).not.toHaveBeenCalled()

    await exportAuditEventsCsv(
      viewer,
      { action: 'member', since: '7d' },
      NOW,
      {
        actor: { type: 'MEMBER', clerkId: 'user_1', memberId: 'm_1' },
        source: 'CLI',
        ip: '203.0.113.9',
      }
    )
    expect(mockRepo.create).toHaveBeenCalledTimes(1)
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws_1',
        action: 'audit_log.exported',
        targetType: 'audit_log',
        targetId: null,
        actorType: 'MEMBER',
        actorId: 'user_1',
        source: 'CLI',
        ip: '203.0.113.9',
        metadata: {
          rowCount: 2,
          truncated: false,
          filters: { action: 'member', since: '7d' },
        },
      })
    )
  })

  it('audit export audited: a refused export (not an owner) writes nothing', async () => {
    mockRole.mockResolvedValueOnce('MEMBER')
    mockRepo.create.mockClear()
    await expect(
      exportAuditEventsCsv(viewer, {}, NOW)
    ).rejects.toMatchObject({ status: 403 })
    expect(mockRepo.create).not.toHaveBeenCalled()
  })
})
