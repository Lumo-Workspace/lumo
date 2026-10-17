/**
 * @jest-environment node
 *
 * LUM-907 PR2: `lumo audit list` — filters → query string, the table and
 * next-page hint, --json, --csv (raw CSV + truncation warning), and the
 * server's OWNER-only 403 surfaced as an error.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    email: 'me@x.com',
  })),
}))

import { fmtTimestamp } from '../../cli/src/lib/format'
import {
  auditList,
  auditQuery,
  formatAuditList,
  type AuditListPage,
} from '@/cli/src/commands/audit-list'

let out: string
let err: string
let calls: Array<{ url: string; init: RequestInit | undefined }>

function serve(
  body: string | unknown,
  status = 200,
  headers: Record<string, string> = {}
) {
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      { status, headers }
    )
  }) as unknown as typeof fetch
}

beforeEach(() => {
  out = ''
  err = ''
  calls = []
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((s: unknown) => {
    err += String(s)
  })
})
afterEach(() => jest.restoreAllMocks())

const page: AuditListPage = {
  events: [
    {
      id: 'ev_1',
      createdAt: '2026-10-04T15:54:12.000Z',
      action: 'member.role_changed',
      actorType: 'MEMBER',
      actorId: 'user_1',
      actorName: 'Alice Chen',
      actorEmail: 'alice@example.com',
      source: 'WEB',
      targetType: 'member',
      targetId: 'm_2',
      ip: '203.0.113.9',
    },
    {
      id: 'ev_2',
      createdAt: '2026-10-03T01:02:03.000Z',
      action: 'github_app.uninstalled',
      actorType: 'SYSTEM',
      actorId: null,
      actorName: null,
      actorEmail: null,
      source: 'SYSTEM',
      targetType: 'integration',
      targetId: null,
      ip: null,
    },
  ],
  nextCursor: 'CUR123',
}

describe('lumo audit list', () => {
  it('lumo audit list: flags map to the query string; paging only on list', () => {
    const opts = {
      action: 'invite',
      actor: 'me',
      since: '7d',
      until: '2026-10-04',
      targetType: 'MEMBER',
      target: 'm_2',
      limit: '20',
      cursor: 'C',
    }
    expect(auditQuery(opts, true)).toBe(
      '?action=invite&actor=me&since=7d&until=2026-10-04&targetType=member&targetId=m_2&limit=20&cursor=C'
    )
    expect(auditQuery(opts, false)).not.toMatch(/limit|cursor/)
    expect(auditQuery({}, true)).toBe('')
  })

  it('lumo audit list: prints one row per event and the next-page line', async () => {
    serve(page)
    expect(await auditList({ action: 'member', since: '7d' })).toBeUndefined()
    expect(calls[0]?.url).toBe(
      'https://api.lumo.test/api/workspaces/me/audit-events?action=member&since=7d'
    )
    expect(
      (calls[0]?.init?.headers as Record<string, string>).Authorization
    ).toBe('Bearer tok')
    expect(out).toContain(
      `${fmtTimestamp('2026-10-04T15:54:12.000Z')}\tmember.role_changed\tAlice Chen <alice@example.com>\tmember m_2\tWEB\t203.0.113.9`
    )
    expect(out).toContain(
      `${fmtTimestamp('2026-10-03T01:02:03.000Z')}\tgithub_app.uninstalled\tsystem\tintegration\tSYSTEM\t-\nShowing 1-2.\nNext page: lumo audit list --action member --since 7d --cursor CUR123\n`
    )
  })

  // LUM-1116: values are shell-quoted only when they need it.
  it('lumo audit list: next-page line carries bare values, quoting only unsafe ones', async () => {
    serve(page)
    await auditList({ limit: '2', actor: 'Alice Chen' })
    expect(out).toContain(
      "Next page: lumo audit list --actor 'Alice Chen' --limit 2 --cursor CUR123"
    )
    expect(out).not.toContain('"2"')
  })

  it('lumo audit list: --json prints the page as returned', async () => {
    serve(page)
    await auditList({ json: true })
    expect(JSON.parse(out)).toEqual(page)
  })

  it('lumo audit list: an empty log says so', () => {
    expect(formatAuditList({ events: [], nextCursor: null })).toBe(
      'No audit events.'
    )
  })

  it('lumo audit list: a non-owner gets the server 403 message and exit 1', async () => {
    serve({ error: 'Only workspace owners can view the audit log' }, 403)
    expect(await auditList({})).toBe(1)
    expect(err).toContain('Only workspace owners can view the audit log')
    expect(out).toBe('')
  })

  it('lumo audit list: --csv streams the export and warns when it was capped', async () => {
    serve('"created_at","action"\r\n"x","y"\r\n', 200, {
      'content-type': 'text/csv',
      'x-audit-truncated': 'true',
      'x-audit-row-count': '10000',
    })
    expect(
      await auditList({ csv: true, since: '30d', limit: '5', cursor: 'C' })
    ).toBeUndefined()
    expect(calls[0]?.url).toBe(
      'https://api.lumo.test/api/workspaces/me/audit-events/export?since=30d'
    )
    expect(out).toBe('"created_at","action"\r\n"x","y"\r\n')
    expect(err).toContain('export capped at 10000 events')
  })

  it('lumo audit list: --csv and --json together are refused', async () => {
    serve(page)
    expect(await auditList({ csv: true, json: true })).toBe(1)
    expect(calls).toHaveLength(0)
  })
})
