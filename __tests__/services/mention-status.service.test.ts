import {
  mentionStatusService,
  reducePrState,
  parseTaskIdentifier,
} from '@/lib/services/mention-status.service'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findMany: jest.fn() },
  },
}))

const findMany = prisma.task.findMany as jest.Mock

describe('parseTaskIdentifier', () => {
  it('splits TEAM-N into prefix + number (case-insensitive, uppercased)', () => {
    expect(parseTaskIdentifier('lum-411')).toEqual({
      prefix: 'LUM',
      number: 411,
    })
    expect(parseTaskIdentifier('SPEC-12')).toEqual({
      prefix: 'SPEC',
      number: 12,
    })
  })

  it('returns null for non-identifier shapes', () => {
    expect(parseTaskIdentifier('LUM')).toBeNull()
    expect(parseTaskIdentifier('LUM-')).toBeNull()
    expect(parseTaskIdentifier('-5')).toBeNull()
    expect(parseTaskIdentifier('')).toBeNull()
  })
})

describe('reducePrState', () => {
  it('merged wins over open and closed', () => {
    expect(
      reducePrState([
        { state: 'open' },
        { state: 'merged' },
        { state: 'closed' },
      ])
    ).toBe('merged')
  })

  it('open when an open PR exists and none are merged', () => {
    expect(reducePrState([{ state: 'closed' }, { state: 'open' }])).toBe('open')
  })

  it('none when there are no PRs or only closed ones', () => {
    expect(reducePrState([])).toBe('none')
    expect(reducePrState([{ state: 'closed' }])).toBe('none')
  })
})

describe('mentionStatusService.resolve', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns [] without querying when given no valid identifiers', async () => {
    expect(await mentionStatusService.resolve('w1', [])).toEqual([])
    expect(await mentionStatusService.resolve('w1', ['nope', ''])).toEqual([])
    expect(findMany).not.toHaveBeenCalled()
  })

  it('resolves identifiers to current status and reduced PR state', async () => {
    findMany.mockResolvedValue([
      {
        number: 411,
        status: 'DONE',
        team: { identifier: 'LUM' },
        pullRequests: [{ state: 'open' }, { state: 'merged' }],
      },
      {
        number: 5,
        status: 'IN_PROGRESS',
        team: { identifier: 'LUM' },
        pullRequests: [],
      },
    ])

    const items = await mentionStatusService.resolve('w1', ['LUM-411', 'lum-5'])

    expect(items).toEqual([
      { identifier: 'LUM-411', status: 'DONE', pr: 'merged' },
      { identifier: 'LUM-5', status: 'IN_PROGRESS', pr: 'none' },
    ])
    // Scoped to the caller's workspace.
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0][0].where.workspaceId).toBe('w1')
  })

  it('omits identifiers the caller cannot see (not returned by the scoped query)', async () => {
    findMany.mockResolvedValue([
      {
        number: 411,
        status: 'TODO',
        team: { identifier: 'LUM' },
        pullRequests: [],
      },
    ])

    const items = await mentionStatusService.resolve('w1', [
      'LUM-411',
      'LUM-999',
    ])

    expect(items.map(i => i.identifier)).toEqual(['LUM-411'])
  })
})
