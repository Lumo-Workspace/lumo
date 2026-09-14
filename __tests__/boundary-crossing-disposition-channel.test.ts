/**
 * @jest-environment node
 *
 * LUM-769 — a CLI-confirmed disposition is auditable as such. The service is
 * driven for real over mocked repositories: the CLI attribution
 * (`channel: 'CLI'`) stamps `channel: 'CLI'` on the
 * BOUNDARY_CROSSING_DISPOSITIONED activity payload, the web attribution (no
 * channel) keeps the pre-769 payload shape, and the read model exposes the
 * surface of the current ruling on the crossing view.
 */
import { activityRepository } from '@/lib/repositories/activity.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import {
  boundaryCrossingService,
  latestDispositionChannel,
  lastDispositionChange,
} from '@/lib/services/boundary-crossing.service'

jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findWithProject: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(async () => ({ id: 'actor-1' })),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findById: jest.fn(),
    disposition: jest.fn(async () => ({ count: 1 })),
  },
}))
jest.mock('@/lib/repositories/crossing-suppression-rule.repository', () => ({
  crossingSuppressionRuleRepository: {},
}))

const mockFindById = boundaryCrossingRepository.findById as jest.Mock
const mockCreate = activityRepository.create as jest.Mock

const OPEN_CROSSING = {
  id: 'cx-1',
  taskId: 't-1',
  category: 'TEST_FILE_DELETED',
  detail: 'deleted __tests__/x.test.ts',
  target: '__tests__/x.test.ts',
  disposition: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindById.mockResolvedValue(OPEN_CROSSING)
})

describe('disposition channel (LUM-769)', () => {
  it('a CLI attribution stamps channel CLI on the audit payload', async () => {
    await boundaryCrossingService.disposition(
      't-1',
      'cx-1',
      'FALSE_POSITIVE',
      'relayed approval',
      { actorMemberId: 'm-1', actorClerkId: 'c-1', channel: 'CLI' }
    )
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const payload = mockCreate.mock.calls[0][0].payload as Record<
      string,
      unknown
    >
    expect(payload).toMatchObject({
      boundaryCrossingId: 'cx-1',
      from: null,
      to: 'FALSE_POSITIVE',
      note: 'relayed approval',
      channel: 'CLI',
    })
  })

  it('the web attribution keeps the pre-769 payload shape (no channel key)', async () => {
    await boundaryCrossingService.disposition(
      't-1',
      'cx-1',
      'CONFIRMED',
      null,
      { actorMemberId: 'm-1', actorClerkId: 'c-1' }
    )
    const payload = mockCreate.mock.calls[0][0].payload as Record<
      string,
      unknown
    >
    expect(payload).toEqual({
      boundaryCrossingId: 'cx-1',
      category: 'TEST_FILE_DELETED',
      detail: 'deleted __tests__/x.test.ts',
      from: null,
      to: 'CONFIRMED',
      disposition: 'CONFIRMED',
      note: null,
    })
    expect('channel' in payload).toBe(false)
  })

  it('the read model derives the surface of the latest ruling: CLI, WEB for web/legacy rows, null with no rows', () => {
    const web = {
      payload: { boundaryCrossingId: 'cx-1', from: null, to: 'CONFIRMED' },
      actorId: 'a',
      createdAt: '2026-09-14T00:00:00.000Z',
    }
    const cli = {
      payload: {
        boundaryCrossingId: 'cx-1',
        from: 'CONFIRMED',
        to: 'FALSE_POSITIVE',
        channel: 'CLI',
      },
      actorId: 'a',
      createdAt: '2026-09-14T01:00:00.000Z',
    }
    expect(latestDispositionChannel([])).toBeNull()
    expect(latestDispositionChannel([web])).toBe('WEB')
    expect(latestDispositionChannel([web, cli])).toBe('CLI')
    expect(latestDispositionChannel([cli, web])).toBe('WEB')
    // A correction carries its own channel too.
    expect(lastDispositionChange([web, cli])?.channel).toBe('CLI')
    expect(
      lastDispositionChange([
        cli,
        { ...web, payload: { ...web.payload, from: 'FALSE_POSITIVE' } },
      ])?.channel
    ).toBe('WEB')
  })
})
