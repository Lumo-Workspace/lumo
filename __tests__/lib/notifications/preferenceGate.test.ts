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
  shouldNotifySlackEvent,
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
  // LUM-1101: Slack fails closed for an unmapped type — a future sender added
  // without a route sends nothing instead of ignoring notifySlack*=false.
  it.each(['AGENT_DONE', 'AGENT_FAILED', 'TASK_SPEC_READY'] as const)(
    'fails closed on Slack for unmapped %s',
    async type => {
      mockActorFindUnique.mockResolvedValue({ member: { id: 'member-1' } })
      mockPrefFindUnique.mockResolvedValue({
        notifySlackAgentDone: false,
        notifySlackAssigned: false,
      })

      const result = await shouldNotify('actor-1', 'slack', type)
      expect(result).toBe(false)
      expect(mockPrefFindUnique).not.toHaveBeenCalled()
    }
  )

  it('in-app still delivers an unmapped type (SPRINT_STARTED has no switch)', async () => {
    const result = await shouldNotify('actor-1', 'inApp', 'SPRINT_STARTED')
    expect(result).toBe(true)
    expect(mockActorFindUnique).not.toHaveBeenCalled()
  })

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

// ── Slack fail-closed in batch + PR event gate (LUM-1101) ───────────────────

describe('shouldNotifyBatch Slack fail-closed (LUM-1101)', () => {
  it('returns no recipients on Slack for an unmapped type', async () => {
    const result = await shouldNotifyBatch(
      ['a-1', 'a-2'],
      'slack',
      'AGENT_DONE'
    )
    expect(result.size).toBe(0)
    expect(mockActorFindMany).not.toHaveBeenCalled()
  })

  // LUM-1115: an owner's spec review unblocks a waiting agent — never silenced.
  it('delivers TASK_SPEC_READY in-app even with notifyInAppAssigned=false', async () => {
    mockActorFindMany.mockResolvedValue([{ id: 'a-1', member: { id: 'm-1' } }])
    mockPrefFindMany.mockResolvedValue([
      { memberId: 'm-1', notifyInAppAssigned: false },
    ])
    const result = await shouldNotifyBatch(['a-1'], 'inApp', 'TASK_SPEC_READY')
    expect([...result]).toEqual(['a-1'])
    mockActorFindUnique.mockResolvedValue({ member: { id: 'm-1' } })
    mockPrefFindUnique.mockResolvedValue({ notifyInAppAssigned: false })
    expect(await shouldNotify('a-1', 'inApp', 'TASK_SPEC_READY')).toBe(true)
  })

  it('TASK_SPEC_READY stays fail-closed on Slack (in-app-only exemption)', async () => {
    const result = await shouldNotifyBatch(['a-1'], 'slack', 'TASK_SPEC_READY')
    expect(result.size).toBe(0)
  })

  it('keeps ALWAYS_NOTIFY types deliverable on Slack', async () => {
    const result = await shouldNotifyBatch(['a-1'], 'slack', 'AGENT_CLARIFY')
    expect([...result]).toEqual(['a-1'])
  })
})

describe('shouldNotifySlackEvent (LUM-1101)', () => {
  it.each(['pr_opened', 'pr_merged'] as const)(
    '%s is silenced by notifySlackAssigned=false',
    async event => {
      mockActorFindUnique.mockResolvedValue({ member: { id: 'member-1' } })
      mockPrefFindUnique.mockResolvedValue({ notifySlackAssigned: false })
      expect(await shouldNotifySlackEvent('actor-1', event)).toBe(false)
      expect(mockPrefFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({ select: { notifySlackAssigned: true } })
      )
    }
  )

  it('delivers when no preference row exists', async () => {
    mockActorFindUnique.mockResolvedValue({ member: { id: 'member-1' } })
    mockPrefFindUnique.mockResolvedValue(null)
    expect(await shouldNotifySlackEvent('actor-1', 'pr_opened')).toBe(true)
  })
})
