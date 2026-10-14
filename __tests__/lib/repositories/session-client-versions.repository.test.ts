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
  it('skips the row query when no session reported versions', async () => {
    session.groupBy.mockResolvedValue([])
    expect(
      await sessionRepository.latestClientVersionsByMemberAgent('ws', since)
    ).toEqual([])
    expect(session.findMany).not.toHaveBeenCalled()
  })

  it('fetches only the newest reporting session per member × agent, one row each', async () => {
    session.groupBy.mockResolvedValue([
      { workspaceMemberId: 'm1', agent: 'CODEX', _max: { lastActivityAt: t } },
    ])
    const row = {
      workspaceMemberId: 'm1',
      agent: 'CODEX',
      cliVersion: '1.121.0',
      skillVersion: 'none',
    }
    // Two sessions tied on the max timestamp.
    session.findMany.mockResolvedValue([row, { ...row, cliVersion: '1.120.0' }])
    const out = await sessionRepository.latestClientVersionsByMemberAgent(
      'ws',
      since
    )
    expect(out).toEqual([row])
    const where = session.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({
      workspaceId: 'ws',
      parentSessionId: null,
      lastActivityAt: { gte: since },
    })
    expect(where.AND[1]).toEqual({
      OR: [{ workspaceMemberId: 'm1', agent: 'CODEX', lastActivityAt: t }],
    })
  })
})
