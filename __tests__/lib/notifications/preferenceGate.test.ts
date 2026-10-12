/**
 * @jest-environment node
 */

// Keep the Slack senders (and their DB/token deps) out of this unit test
jest.mock('@/lib/integrations/slack', () => ({
  sendChannelNotification: jest.fn(),
  sendDMNotification: jest.fn(),
  handleCommand: jest.fn(),
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    actor: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    userPreference: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import {
  shouldNotify,
  shouldNotifyBatch,
} from '@/lib/services/notification.service'

const mockActorFindUnique = prisma.actor.findUnique as jest.Mock
const mockActorFindMany = prisma.actor.findMany as jest.Mock
const mockPrefFindUnique = prisma.userPreference.findUnique as jest.Mock
const mockPrefFindMany = prisma.userPreference.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

// ── shouldNotify ────────────────────────────────────────────────────────────

describe('shouldNotify', () => {
  it('always returns true for AGENT_CLARIFY (requiresAction)', async () => {
    const result = await shouldNotify('actor-1', 'inApp', 'AGENT_CLARIFY')
    expect(result).toBe(true)
    expect(mockActorFindUnique).not.toHaveBeenCalled()
  })

  it('always returns true for AGENT_AUTHORIZE (requiresAction)', async () => {
    const result = await shouldNotify('actor-1', 'slack', 'AGENT_AUTHORIZE')
    expect(result).toBe(true)
  })

  it('always returns true for AGENT_VERIFY (requiresAction)', async () => {
    const result = await shouldNotify('actor-1', 'inApp', 'AGENT_VERIFY')
    expect(result).toBe(true)
  })

  it('returns true when no preference record exists (defaults)', async () => {
    mockActorFindUnique.mockResolvedValue({ member: { id: 'member-1' } })
    mockPrefFindUnique.mockResolvedValue(null)

    const result = await shouldNotify('actor-1', 'inApp', 'TASK_ASSIGNED')
    expect(result).toBe(true)
  })

  it('returns true when preference toggle is true', async () => {
    mockActorFindUnique.mockResolvedValue({ member: { id: 'member-1' } })
    mockPrefFindUnique.mockResolvedValue({ notifyInAppAssigned: true })

    const result = await shouldNotify('actor-1', 'inApp', 'TASK_ASSIGNED')
    expect(result).toBe(true)
  })

  it('returns false when inApp preference toggle is false', async () => {
    mockActorFindUnique.mockResolvedValue({ member: { id: 'member-1' } })
    mockPrefFindUnique.mockResolvedValue({ notifyInAppAssigned: false })

    const result = await shouldNotify('actor-1', 'inApp', 'TASK_ASSIGNED')
    expect(result).toBe(false)
  })

  it('returns false when slack preference toggle is false', async () => {
    mockActorFindUnique.mockResolvedValue({ member: { id: 'member-1' } })
    mockPrefFindUnique.mockResolvedValue({ notifySlackMention: false })

    const result = await shouldNotify('actor-1', 'slack', 'TASK_MENTIONED')
    expect(result).toBe(false)
  })

  it('maps TASK_SENT_BACK to notifyInAppAssigned', async () => {
    mockActorFindUnique.mockResolvedValue({ member: { id: 'member-1' } })
    mockPrefFindUnique.mockResolvedValue({ notifyInAppAssigned: false })

    const result = await shouldNotify('actor-1', 'inApp', 'TASK_SENT_BACK')
    expect(result).toBe(false)
  })

  // LUM-1098: these types have no Slack send path, so the Slack channel has
  // no preference route for them (the notifySlackAgent* columns are unread).
  it.each(['AGENT_DONE', 'AGENT_FAILED', 'TASK_SPEC_READY'] as const)(
    'has no Slack preference route for %s',
    async type => {
      mockActorFindUnique.mockResolvedValue({ member: { id: 'member-1' } })
      mockPrefFindUnique.mockResolvedValue({
        notifySlackAgentDone: false,
        notifySlackAssigned: false,
      })

      const result = await shouldNotify('actor-1', 'slack', type)
      expect(result).toBe(true)
      expect(mockPrefFindUnique).not.toHaveBeenCalled()
    }
  )

  it('still gates the in-app channel for AGENT_DONE', async () => {
    mockActorFindUnique.mockResolvedValue({ member: { id: 'member-1' } })
    mockPrefFindUnique.mockResolvedValue({ notifyInAppAgentDone: false })

    const result = await shouldNotify('actor-1', 'inApp', 'AGENT_DONE')
    expect(result).toBe(false)
  })

  it('still gates Slack TASK_ASSIGNED on notifySlackAssigned', async () => {
    mockActorFindUnique.mockResolvedValue({ member: { id: 'member-1' } })
    mockPrefFindUnique.mockResolvedValue({ notifySlackAssigned: false })

    const result = await shouldNotify('actor-1', 'slack', 'TASK_ASSIGNED')
    expect(result).toBe(false)
  })

  it('returns true when actor has no member (non-human)', async () => {
    mockActorFindUnique.mockResolvedValue({ member: null })

    const result = await shouldNotify('actor-1', 'inApp', 'TASK_ASSIGNED')
    expect(result).toBe(true)
    expect(mockPrefFindUnique).not.toHaveBeenCalled()
  })

  it('returns true when actor is not found', async () => {
    mockActorFindUnique.mockResolvedValue(null)

    const result = await shouldNotify('actor-1', 'inApp', 'TASK_ASSIGNED')
    expect(result).toBe(true)
  })
})

// ── shouldNotifyBatch ───────────────────────────────────────────────────────

describe('shouldNotifyBatch', () => {
  it('returns empty set for empty input', async () => {
    const result = await shouldNotifyBatch([], 'inApp', 'TASK_MENTIONED')
    expect(result.size).toBe(0)
  })

  it('returns all IDs for requiresAction types', async () => {
    const result = await shouldNotifyBatch(
      ['a1', 'a2'],
      'inApp',
      'AGENT_CLARIFY'
    )
    expect(result).toEqual(new Set(['a1', 'a2']))
    expect(mockActorFindMany).not.toHaveBeenCalled()
  })

  it('filters out actors whose preference is false', async () => {
    mockActorFindMany.mockResolvedValue([
      { id: 'a1', member: { id: 'm1' } },
      { id: 'a2', member: { id: 'm2' } },
    ])
    mockPrefFindMany.mockResolvedValue([
      { memberId: 'm1', notifyInAppMention: true },
      { memberId: 'm2', notifyInAppMention: false },
    ])

    const result = await shouldNotifyBatch(
      ['a1', 'a2'],
      'inApp',
      'TASK_MENTIONED'
    )
    expect(result).toEqual(new Set(['a1']))
  })

  it('includes actors with no preference record (defaults)', async () => {
    mockActorFindMany.mockResolvedValue([
      { id: 'a1', member: { id: 'm1' } },
      { id: 'a2', member: { id: 'm2' } },
    ])
    mockPrefFindMany.mockResolvedValue([
      { memberId: 'm1', notifySlackMention: false },
      // m2 has no pref → defaults to true
    ])

    const result = await shouldNotifyBatch(
      ['a1', 'a2'],
      'slack',
      'TASK_MENTIONED'
    )
    expect(result).toEqual(new Set(['a2']))
  })

  it('includes non-human actors (no member)', async () => {
    mockActorFindMany.mockResolvedValue([
      { id: 'a1', member: null },
      { id: 'a2', member: { id: 'm2' } },
    ])
    mockPrefFindMany.mockResolvedValue([
      { memberId: 'm2', notifyInAppMention: false },
    ])

    const result = await shouldNotifyBatch(
      ['a1', 'a2'],
      'inApp',
      'TASK_MENTIONED'
    )
    expect(result).toEqual(new Set(['a1']))
  })
})
