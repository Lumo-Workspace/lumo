import {
  connectionFixCommand,
  connectionNeedsUpdate,
  countConnectionsNeedingUpdate,
  matchesMemberFilter,
  matchesMemberQuery,
  memberVersionStatus,
} from '@/lib/members/connection-status'
import type { MemberConnectionView } from '@/lib/services/member-connection.service'

const conn = (p: Partial<MemberConnectionView> = {}): MemberConnectionView => ({
  agent: 'CLAUDE_CODE',
  cliVersion: '1.121.0',
  skillVersion: '1.121.0',
  lastSeenAt: '2026-10-14T10:00:00Z',
  cliBehind: false,
  skillBehind: false,
  ...p,
})

describe('memberVersionStatus', () => {
  it('no connections → notConnected', () => {
    expect(memberVersionStatus(undefined)).toBe('notConnected')
    expect(memberVersionStatus([])).toBe('notConnected')
  })
  it('all current → upToDate', () => {
    expect(memberVersionStatus([conn(), conn({ agent: 'CODEX' })])).toBe(
      'upToDate'
    )
  })
  it('any behind (CLI or skill) → needsUpdate, even next to an unknown one', () => {
    expect(memberVersionStatus([conn({ skillBehind: true })])).toBe(
      'needsUpdate'
    )
    expect(
      memberVersionStatus([
        conn({ cliVersion: null }),
        conn({ agent: 'CODEX', cliBehind: true }),
      ])
    ).toBe('needsUpdate')
  })
  it('an unreported CLI with nothing behind → unknown', () => {
    expect(memberVersionStatus([conn(), conn({ cliVersion: null })])).toBe(
      'unknown'
    )
  })
})

describe('matchesMemberFilter', () => {
  it('all matches every status', () => {
    for (const s of [
      'needsUpdate',
      'unknown',
      'upToDate',
      'notConnected',
    ] as const)
      expect(matchesMemberFilter(s, 'all')).toBe(true)
  })
  it('needsUpdate does not include unknown', () => {
    expect(matchesMemberFilter('needsUpdate', 'needsUpdate')).toBe(true)
    expect(matchesMemberFilter('unknown', 'needsUpdate')).toBe(false)
  })
  it('notConnected matches only notConnected', () => {
    expect(matchesMemberFilter('notConnected', 'notConnected')).toBe(true)
    expect(matchesMemberFilter('upToDate', 'notConnected')).toBe(false)
  })
})

describe('matchesMemberQuery', () => {
  const m = { name: 'Priya Natarajan', email: 'Priya@uselumo.ai' }
  it('blank query matches', () =>
    expect(matchesMemberQuery(m, '  ')).toBe(true))
  it('matches name or email, case-insensitively', () => {
    expect(matchesMemberQuery(m, 'nata')).toBe(true)
    expect(matchesMemberQuery(m, 'PRIYA@')).toBe(true)
    expect(matchesMemberQuery(m, 'alex')).toBe(false)
  })
  it('handles a null email', () =>
    expect(matchesMemberQuery({ name: 'Sam', email: null }, 'x')).toBe(false))
})

describe('countConnectionsNeedingUpdate', () => {
  it('counts connections, not members', () => {
    expect(
      countConnectionsNeedingUpdate({
        a: [conn(), conn({ agent: 'CODEX', skillBehind: true })],
        b: [conn({ cliBehind: true, skillBehind: true })],
        c: [conn({ cliVersion: null })],
      })
    ).toBe(2)
  })
  it('empty map → 0', () => expect(countConnectionsNeedingUpdate({})).toBe(0))
})

describe('connectionNeedsUpdate / connectionFixCommand', () => {
  it('current connection needs nothing', () => {
    expect(connectionNeedsUpdate(conn())).toBe(false)
    expect(connectionFixCommand(conn())).toBeNull()
  })
  it('CLI behind or unreported → lumo update', () => {
    expect(
      connectionFixCommand(conn({ cliBehind: true, skillBehind: true }))
    ).toBe('lumo update')
    expect(connectionFixCommand(conn({ cliVersion: null }))).toBe('lumo update')
  })
  it('only the skill behind → lumo skill update', () =>
    expect(connectionFixCommand(conn({ skillBehind: true }))).toBe(
      'lumo skill update'
    ))
})
