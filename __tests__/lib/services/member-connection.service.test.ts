/**
 * @jest-environment node
 *
 * LUM-1136 — members page connections: per member × agent, last seen plus
 * the latest reported CLI version, with "behind" marks.
 */
jest.mock('@/lib/cli/latest-version', () => ({
  fetchLatestCliVersion: jest.fn(),
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    lastActivityByMemberAgent: jest.fn(),
    latestClientVersionsByMemberAgent: jest.fn(),
  },
}))

import { sessionRepository } from '@/lib/repositories/session.repository'
import { fetchLatestCliVersion } from '@/lib/cli/latest-version'
import {
  buildMemberConnections,
  CONNECTION_WINDOW_DAYS,
  memberConnectionService,
  STALE_CONNECTION_DAYS,
} from '@/lib/services/member-connection.service'

const sess = sessionRepository as jest.Mocked<typeof sessionRepository>
const mockLatest = fetchLatestCliVersion as jest.Mock
const d = (iso: string) => new Date(iso)
const NOW = d('2026-10-14T12:00:00Z')
const build = (
  activity: Parameters<typeof buildMemberConnections>[0],
  versions: Parameters<typeof buildMemberConnections>[1],
  latest: string | null = null
) => buildMemberConnections(activity, versions, latest, NOW)

describe('buildMemberConnections', () => {
  it('one entry per agent, most recently seen first, with versions merged', () => {
    const out = build(
      [
        {
          workspaceMemberId: 'm1',
          agent: 'CODEX',
          lastActivityAt: d('2026-10-10T00:00:00Z'),
        },
        {
          workspaceMemberId: 'm1',
          agent: 'CLAUDE_CODE',
          lastActivityAt: d('2026-10-14T00:00:00Z'),
        },
      ],
      [
        {
          workspaceMemberId: 'm1',
          agent: 'CLAUDE_CODE',
          cliVersion: '1.121.0',
        },
        {
          workspaceMemberId: 'm1',
          agent: 'CODEX',
          cliVersion: '1.121.0',
        },
      ]
    )
    expect(out).toEqual({
      m1: [
        {
          agent: 'CLAUDE_CODE',
          cliVersion: '1.121.0',
          lastSeenAt: '2026-10-14T00:00:00.000Z',
          stale: false,
          cliBehind: false,
        },
        {
          agent: 'CODEX',
          cliVersion: '1.121.0',
          lastSeenAt: '2026-10-10T00:00:00.000Z',
          stale: false,
          cliBehind: false,
        },
      ],
    })
  })

  it('a session from a CLI without the headers yields null versions, not a missing row', () => {
    const out = build(
      [
        {
          workspaceMemberId: 'm2',
          agent: 'CLAUDE_CODE',
          lastActivityAt: d('2026-10-14T00:00:00Z'),
        },
      ],
      []
    )
    expect(out.m2).toEqual([
      expect.objectContaining({
        cliVersion: null,
        cliBehind: false,
      }),
    ])
  })

  it('marks a CLI older than the newest in the workspace (numeric, not lexical)', () => {
    const out = build(
      [
        {
          workspaceMemberId: 'a',
          agent: 'CLAUDE_CODE',
          lastActivityAt: d('2026-10-14T00:00:00Z'),
        },
        {
          workspaceMemberId: 'b',
          agent: 'CLAUDE_CODE',
          lastActivityAt: d('2026-10-14T00:00:00Z'),
        },
      ],
      [
        {
          workspaceMemberId: 'a',
          agent: 'CLAUDE_CODE',
          cliVersion: '1.9.0',
        },
        {
          workspaceMemberId: 'b',
          agent: 'CLAUDE_CODE',
          cliVersion: '1.10.0',
        },
      ]
    )
    expect(out.a?.[0]?.cliBehind).toBe(true)
    expect(out.b?.[0]?.cliBehind).toBe(false)
  })

  it('exposes no skill fields, even for a version row that still carries one', () => {
    const out = build(
      [
        {
          workspaceMemberId: 'a',
          agent: 'CLAUDE_CODE',
          lastActivityAt: d('2026-10-14T00:00:00Z'),
        },
      ],
      [
        {
          workspaceMemberId: 'a',
          agent: 'CLAUDE_CODE',
          cliVersion: '1.121.0',
          ...({ skillVersion: '1.119.0' } as object),
        },
      ]
    )
    const c = out.a?.[0]
    expect(c).not.toHaveProperty('skillVersion')
    expect(c).not.toHaveProperty('skillBehind')
    expect(Object.keys(c ?? {}).sort()).toEqual([
      'agent',
      'cliBehind',
      'cliVersion',
      'lastSeenAt',
      'stale',
    ])
  })

  it('measures CLIs against the latest published version when known', () => {
    const out = build(
      [
        {
          workspaceMemberId: 'a',
          agent: 'CLAUDE_CODE',
          lastActivityAt: d('2026-10-14T00:00:00Z'),
        },
      ],
      [
        {
          workspaceMemberId: 'a',
          agent: 'CLAUDE_CODE',
          cliVersion: '1.121.0',
        },
      ],
      '1.122.0'
    )
    // Newest in the workspace, but behind what npm publishes.
    expect(out.a?.[0]?.cliBehind).toBe(true)
  })

  it('a connection unseen for over STALE_CONNECTION_DAYS is stale and never judged behind', () => {
    const at = (days: number) => new Date(NOW.getTime() - days * 86_400_000)
    const out = build(
      [
        {
          workspaceMemberId: 'm',
          agent: 'CODEX',
          lastActivityAt: at(STALE_CONNECTION_DAYS + 1),
        },
        {
          workspaceMemberId: 'm',
          agent: 'CLAUDE_CODE',
          lastActivityAt: at(STALE_CONNECTION_DAYS - 1),
        },
      ],
      [
        {
          workspaceMemberId: 'm',
          agent: 'CODEX',
          cliVersion: '1.121.0',
        },
        {
          workspaceMemberId: 'm',
          agent: 'CLAUDE_CODE',
          cliVersion: '1.121.0',
        },
      ],
      '1.122.0'
    )
    const byAgent = Object.fromEntries((out.m ?? []).map(c => [c.agent, c]))
    expect(byAgent.CODEX).toMatchObject({
      stale: true,
      cliVersion: '1.121.0',
      cliBehind: false,
    })
    expect(byAgent.CLAUDE_CODE).toMatchObject({
      stale: false,
      cliBehind: true,
    })
  })

  it('skips activity rows without a timestamp', () => {
    expect(
      build(
        [{ workspaceMemberId: 'm', agent: 'CODEX', lastActivityAt: null }],
        []
      )
    ).toEqual({})
  })
})

describe('memberConnectionService.listConnections', () => {
  it('queries the 30-day window for the workspace and merges the rows', async () => {
    sess.lastActivityByMemberAgent.mockResolvedValue([
      {
        workspaceMemberId: 'm1',
        agent: 'CLAUDE_CODE',
        lastActivityAt: d('2026-10-13T00:00:00Z'),
      },
    ] as never)
    sess.latestClientVersionsByMemberAgent.mockResolvedValue([
      {
        workspaceMemberId: 'm1',
        agent: 'CLAUDE_CODE',
        cliVersion: '1.121.0',
      },
    ] as never)
    mockLatest.mockResolvedValue('1.122.0')
    const now = d('2026-10-14T00:00:00Z')
    const out = await memberConnectionService.listConnections('ws_1', now)
    const since = new Date(now.getTime() - CONNECTION_WINDOW_DAYS * 86_400_000)
    expect(sess.lastActivityByMemberAgent).toHaveBeenCalledWith('ws_1', since)
    expect(sess.latestClientVersionsByMemberAgent).toHaveBeenCalledWith(
      'ws_1',
      since
    )
    expect(out.latestCliVersion).toBe('1.122.0')
    expect(out.connections.m1?.[0]).toMatchObject({
      cliVersion: '1.121.0',
      cliBehind: true,
    })
  })
})
