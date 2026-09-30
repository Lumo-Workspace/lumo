/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    waitlistEntry: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    apiKey: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    userPreference: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    priorityOverride: {
      create: jest.fn(),
    },
    documentMention: {
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { miscRepository } from '@/lib/repositories/misc.repository'

beforeEach(() => jest.clearAllMocks())

// ── WaitlistEntry ──────────────────────────────────────────────────────────

describe('miscRepository.findWaitlistEntryByEmail', () => {
  it('returns entry when found', async () => {
    const entry = { id: 'w1', email: 'test@example.com' }
    ;(prisma.waitlistEntry.findUnique as jest.Mock).mockResolvedValue(entry)

    const result =
      await miscRepository.findWaitlistEntryByEmail('test@example.com')

    expect(result).toEqual(entry)
    expect(prisma.waitlistEntry.findUnique).toHaveBeenCalledWith({
      where: { email: 'test@example.com' },
    })
  })
})

describe('miscRepository.createWaitlistEntry', () => {
  it('creates a waitlist entry', async () => {
    const data = {
      email: 'test@example.com',
      name: 'Test',
      company: null,
      teamSize: null,
    }
    const created = { id: 'w1', ...data }
    ;(prisma.waitlistEntry.create as jest.Mock).mockResolvedValue(created)

    const result = await miscRepository.createWaitlistEntry(data)

    expect(result).toEqual(created)
    expect(prisma.waitlistEntry.create).toHaveBeenCalledWith({ data })
  })
})

// ── ApiKey ──────────────────────────────────────────────────────────────────

describe('miscRepository.findActiveApiKeys', () => {
  it('returns non-revoked keys with select', async () => {
    const keys = [{ id: 'k1', label: 'Dev', keyPrefix: 'lum_abc' }]
    ;(prisma.apiKey.findMany as jest.Mock).mockResolvedValue(keys)

    const result = await miscRepository.findActiveApiKeys('member-1')

    expect(result).toEqual(keys)
    expect(prisma.apiKey.findMany).toHaveBeenCalledWith({
      where: { workspaceMemberId: 'member-1', revokedAt: null },
      select: {
        id: true,
        label: true,
        keyPrefix: true,
        createdAt: true,
        lastUsedAt: true,
        scope: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  })
})

describe('miscRepository.findApiKeyById', () => {
  it('returns key with ownership fields', async () => {
    const key = { workspaceMemberId: 'member-1', revokedAt: null }
    ;(prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(key)

    const result = await miscRepository.findApiKeyById('k1')

    expect(result).toEqual(key)
    expect(prisma.apiKey.findUnique).toHaveBeenCalledWith({
      where: { id: 'k1' },
      select: { workspaceMemberId: true, revokedAt: true },
    })
  })
})

describe('miscRepository.createApiKey', () => {
  it('creates an API key with select', async () => {
    const data = {
      workspaceMemberId: 'm1',
      label: 'Test',
      keyHash: 'hash',
      keyPrefix: 'lum_abc',
    }
    const created = {
      id: 'k1',
      label: 'Test',
      keyPrefix: 'lum_abc',
      createdAt: new Date(),
    }
    ;(prisma.apiKey.create as jest.Mock).mockResolvedValue(created)

    const result = await miscRepository.createApiKey(data)

    expect(result).toEqual(created)
    expect(prisma.apiKey.create).toHaveBeenCalledWith({
      data,
      select: {
        id: true,
        label: true,
        keyPrefix: true,
        createdAt: true,
        scope: true,
      },
    })
  })
})

describe('miscRepository.revokeApiKey', () => {
  it('soft-deletes by setting revokedAt', async () => {
    ;(prisma.apiKey.update as jest.Mock).mockResolvedValue({ id: 'k1' })

    await miscRepository.revokeApiKey('k1')

    expect(prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: 'k1' },
      data: { revokedAt: expect.any(Date) },
    })
  })
})

// ── UserPreference ─────────────────────────────────────────────────────────

describe('miscRepository.findUserPreference', () => {
  it('returns preference when found', async () => {
    const pref = { memberId: 'm1', theme: 'dark' }
    ;(prisma.userPreference.findUnique as jest.Mock).mockResolvedValue(pref)

    const result = await miscRepository.findUserPreference('m1')

    expect(result).toEqual(pref)
    expect(prisma.userPreference.findUnique).toHaveBeenCalledWith({
      where: { memberId: 'm1' },
    })
  })
})

describe('miscRepository.upsertUserPreference', () => {
  it('upserts preference with provided fields', async () => {
    const update = { theme: 'dark', locale: 'zh' }
    const upserted = { memberId: 'm1', ...update }
    ;(prisma.userPreference.upsert as jest.Mock).mockResolvedValue(upserted)

    const result = await miscRepository.upsertUserPreference('m1', update)

    expect(result).toEqual(upserted)
    expect(prisma.userPreference.upsert).toHaveBeenCalledWith({
      where: { memberId: 'm1' },
      update,
      create: { memberId: 'm1', ...update },
    })
  })
})

// ── PriorityOverride ───────────────────────────────────────────────────────

describe('miscRepository.createPriorityOverride', () => {
  it('creates a priority override record', async () => {
    const data = {
      taskId: 't1',
      memberId: 'm1',
      projectId: 'p1',
      aiSuggested: 'HIGH' as const,
      userChosen: 'LOW' as const,
      taskTitle: 'Fix bug',
      taskDescription: null,
    }
    ;(prisma.priorityOverride.create as jest.Mock).mockResolvedValue({
      id: 'po1',
      ...data,
    })

    const result = await miscRepository.createPriorityOverride(data)

    expect(result).toEqual({ id: 'po1', ...data })
    expect(prisma.priorityOverride.create).toHaveBeenCalledWith({ data })
  })
})

// ── DocumentMention ────────────────────────────────────────────────────────

describe('miscRepository.findDocumentMentionsByTask', () => {
  it('returns document mentions with document details including tree fields', async () => {
    const updatedAt = new Date()
    const mentions = [
      {
        id: 'dm1',
        document: {
          id: 'doc1',
          title: 'Design',
          emoji: null,
          updatedAt,
          parentId: null,
          sortOrder: 0,
          visibility: 'WORKSPACE',
          project: { id: 'prj1', name: 'Lumo' },
        },
      },
    ]
    ;(prisma.documentMention.findMany as jest.Mock).mockResolvedValue(mentions)

    const result = await miscRepository.findDocumentMentionsByTask(
      't1',
      'ws-1',
      'm1'
    )

    expect(result).toEqual(mentions)
    expect(prisma.documentMention.findMany).toHaveBeenCalledWith({
      where: {
        taskId: 't1',
        document: {
          workspaceId: 'ws-1',
          deletedAt: null,
          OR: [
            { createdById: 'm1' },
            { visibility: 'WORKSPACE' },
            { shares: { some: { memberId: 'm1' } } },
          ],
        },
      },
      include: {
        document: {
          select: {
            id: true,
            slug: true,
            title: true,
            emoji: true,
            updatedAt: true,
            parentId: true,
            sortOrder: true,
            visibility: true,
            project: { select: { id: true, name: true } },
          },
        },
      },
    })
  })
})
