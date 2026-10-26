/**
 * @jest-environment node
 *
 * LUM-1136 — session repository reads/writes for the members page
 * connections: versions are written only for keys present, and the latest
 * versions per member × agent are read with two bounded queries.
 */
jest.mock('@/lib/db/prisma', () => {
  const prisma: {
    session: Record<string, jest.Mock>
    $transaction: jest.Mock
  } = {
    session: {
      updateMany: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
  }
  return { prisma }
})

import { prisma } from '@/lib/db/prisma'
import { sessionRepository } from '@/lib/repositories/session.repository'

const session = prisma.session as unknown as {
  updateMany: jest.Mock
  groupBy: jest.Mock
  findMany: jest.Mock
  upsert: jest.Mock
  findUnique: jest.Mock
}
const since = new Date('2026-09-14T00:00:00Z')
const t = new Date('2026-10-14T00:00:00Z')

beforeEach(() => jest.clearAllMocks())

describe('upsertForHookEvent — CLI version on every event', () => {
  const base = {
    id: 's1',
    workspaceId: 'ws',
    workspaceMemberId: 'wm',
    cwd: null,
    now: t,
  }
  const usage = {
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    byModel: {},
  }
  beforeEach(() => {
    session.upsert.mockResolvedValue({
      id: 's1',
      taskId: null,
      role: null,
      milestoneId: null,
    })
    session.findUnique.mockResolvedValue(null)
  })

  it.each([
    ['plain event', {}],
    ['mid-turn usage', { usage }],
    ['STOP with usage', { usage, isStop: true }],
  ])('%s writes cliVersion on create and update', async (_label, extra) => {
    await sessionRepository.upsertForHookEvent({
      ...base,
      ...extra,
      cliVersion: '1.122.0',
    })
    const arg = session.upsert.mock.calls[0]?.[0]
    expect(arg.create.cliVersion).toBe('1.122.0')
    expect(arg.update.cliVersion).toBe('1.122.0')
  })

  it('without a reported version it leaves the column alone', async () => {
    await sessionRepository.upsertForHookEvent(base)
    const arg = session.upsert.mock.calls[0]?.[0]
    expect(arg.create).not.toHaveProperty('cliVersion')
    expect(arg.update).not.toHaveProperty('cliVersion')
  })
})

describe('latestClientVersionsByMemberAgent', () => {
  it('skips the row queries when no session reported versions', async () => {
    session.groupBy.mockResolvedValue([])
    expect(
      await sessionRepository.latestClientVersionsByMemberAgent('ws', since)
    ).toEqual([])
    expect(session.findMany).not.toHaveBeenCalled()
  })

  it('reads only cliVersion: the newest reporting session per pair', async () => {
    session.groupBy.mockResolvedValue([
      { workspaceMemberId: 'm1', agent: 'CODEX', _max: { lastActivityAt: t } },
    ])
    session.findMany.mockResolvedValue([
      { workspaceMemberId: 'm1', agent: 'CODEX', cliVersion: '1.121.0' },
      // tie on the max timestamp: first wins
      { workspaceMemberId: 'm1', agent: 'CODEX', cliVersion: '1.120.0' },
    ])
    expect(
      await sessionRepository.latestClientVersionsByMemberAgent('ws', since)
    ).toEqual([
      { workspaceMemberId: 'm1', agent: 'CODEX', cliVersion: '1.121.0' },
    ])
    expect(session.groupBy).toHaveBeenCalledTimes(1)
    expect(session.groupBy.mock.calls[0]![0].where).toMatchObject({
      cliVersion: { not: null },
    })
    const call = session.findMany.mock.calls[0]![0]
    expect(call.select).toEqual({
      workspaceMemberId: true,
      agent: true,
      cliVersion: true,
    })
    expect(call.where).toMatchObject({
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
    expect(session.findMany).toHaveBeenCalledTimes(3)
    expect(
      Math.max(...session.findMany.mock.calls.map(c => c[0].where.OR.length))
    ).toBe(100)
  })
})
