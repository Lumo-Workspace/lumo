/**
 * @jest-environment node
 *
 * LUM-1136 — session repository reads/writes for the members page
 * connections: versions are written only for keys present, and the latest
 * versions per member × agent are read with two bounded queries.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    session: {
      updateMany: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { sessionRepository } from '@/lib/repositories/session.repository'

const session = prisma.session as unknown as {
  updateMany: jest.Mock
  groupBy: jest.Mock
  findMany: jest.Mock
}
const since = new Date('2026-09-14T00:00:00Z')
const t = new Date('2026-10-14T00:00:00Z')

beforeEach(() => jest.clearAllMocks())

describe('recordClientVersions', () => {
  it('writes only the versions present', async () => {
    await sessionRepository.recordClientVersions('s1', {
      cliVersion: '1.121.0',
    })
    expect(session.updateMany).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { cliVersion: '1.121.0' },
    })
  })

  it('no-op when nothing was reported', async () => {
    await sessionRepository.recordClientVersions('s1', {})
    expect(session.updateMany).not.toHaveBeenCalled()
  })
})

describe('latestClientVersionsByMemberAgent', () => {
  const byField = (where: Record<string, unknown>) =>
    'cliVersion' in where ? 'cliVersion' : 'skillVersion'

  it('skips the row queries when no session reported versions', async () => {
    session.groupBy.mockResolvedValue([])
    expect(
      await sessionRepository.latestClientVersionsByMemberAgent('ws', since)
    ).toEqual([])
    expect(session.findMany).not.toHaveBeenCalled()
  })

  it('takes each field from the newest session that reported it', async () => {
    const older = new Date('2026-10-10T00:00:00Z')
    // Newest session reported only the CLI; the skill came from an older one.
    session.groupBy.mockImplementation(async ({ where }) => [
      {
        workspaceMemberId: 'm1',
        agent: 'CODEX',
        _max: { lastActivityAt: byField(where) === 'cliVersion' ? t : older },
      },
    ])
    session.findMany.mockImplementation(async ({ where }) =>
      byField(where) === 'cliVersion'
        ? [
            { workspaceMemberId: 'm1', agent: 'CODEX', cliVersion: '1.121.0' },
            // tie on the max timestamp: first wins
            { workspaceMemberId: 'm1', agent: 'CODEX', cliVersion: '1.120.0' },
          ]
        : [{ workspaceMemberId: 'm1', agent: 'CODEX', skillVersion: '1.119.0' }]
    )
    expect(
      await sessionRepository.latestClientVersionsByMemberAgent('ws', since)
    ).toEqual([
      {
        workspaceMemberId: 'm1',
        agent: 'CODEX',
        cliVersion: '1.121.0',
        skillVersion: '1.119.0',
      },
    ])
    const cliCall = session.findMany.mock.calls.find(
      c => byField(c[0].where) === 'cliVersion'
    )![0]
    expect(cliCall.where).toMatchObject({
      workspaceId: 'ws',
      parentSessionId: null,
      lastActivityAt: { gte: since },
      cliVersion: { not: null },
      OR: [{ workspaceMemberId: 'm1', agent: 'CODEX', lastActivityAt: t }],
    })
  })

  it('reads the rows in chunks of 100 member × agent pairs', async () => {
    const groups = Array.from({ length: 250 }, (_, i) => ({
      workspaceMemberId: `m${i}`,
      agent: 'CLAUDE_CODE',
      _max: { lastActivityAt: t },
    }))
    session.groupBy.mockResolvedValue(groups)
    session.findMany.mockResolvedValue([])
    await sessionRepository.latestClientVersionsByMemberAgent('ws', since)
    // 3 chunks per field × 2 fields
    expect(session.findMany).toHaveBeenCalledTimes(6)
    expect(
      Math.max(...session.findMany.mock.calls.map(c => c[0].where.OR.length))
    ).toBe(100)
  })
})
