/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    ideaSlackContext: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    ideaWebLink: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    ideaFigmaLink: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { ideaSlackContextRepository } from '@/lib/repositories/idea-slack-context.repository'
import { ideaWebLinkRepository } from '@/lib/repositories/idea-web-link.repository'
import { ideaFigmaLinkRepository } from '@/lib/repositories/idea-figma-link.repository'

beforeEach(() => jest.clearAllMocks())

describe('ideaWebLinkRepository', () => {
  it('create maps ideaId and listByIdea orders desc', async () => {
    const create = prisma.ideaWebLink.create as jest.Mock
    const findMany = prisma.ideaWebLink.findMany as jest.Mock
    create.mockResolvedValue({ id: 'x' })
    await ideaWebLinkRepository.create({
      ideaId: 'idea1',
      workspaceId: 'w',
      url: 'https://a.com',
      domain: 'a.com',
      title: null,
      description: null,
      note: null,
      imageUrl: null,
      faviconUrl: null,
      fetchedAt: null,
      fetchError: null,
      createdById: 'm1',
    })
    expect(create.mock.calls[0][0].data.ideaId).toBe('idea1')

    findMany.mockResolvedValue([])
    await ideaWebLinkRepository.listByIdea('idea1')
    expect(findMany.mock.calls[0][0].where).toEqual({ ideaId: 'idea1' })
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' })
  })
})

describe('ideaSlackContextRepository', () => {
  it('create maps ideaId', async () => {
    const create = prisma.ideaSlackContext.create as jest.Mock
    create.mockResolvedValue({ id: 'ctx_1' })
    await ideaSlackContextRepository.create({
      ideaId: 'idea1',
      workspaceId: 'w',
      permalink: 'https://lumo.slack.com/archives/C9/p1700000000000100',
      slackTeamId: 'T1',
      slackChannelId: 'C9',
      slackChannelName: 'design',
      rootTs: '1700000000.000100',
      threadTs: null,
      isThread: false,
      snapshot: { messages: [] },
      snapshotAt: new Date('2026-05-19T10:00:00Z'),
      createdById: 'm1',
    })
    expect(create.mock.calls[0][0].data.ideaId).toBe('idea1')
  })

  it('listByIdea orders by createdAt desc', async () => {
    const findMany = prisma.ideaSlackContext.findMany as jest.Mock
    findMany.mockResolvedValue([])
    await ideaSlackContextRepository.listByIdea('idea1')
    expect(findMany).toHaveBeenCalledWith({
      where: { ideaId: 'idea1' },
      orderBy: { createdAt: 'desc' },
    })
  })
})

describe('ideaFigmaLinkRepository', () => {
  it('create maps ideaId', async () => {
    const create = prisma.ideaFigmaLink.create as jest.Mock
    create.mockResolvedValue({ id: 'cfl_1' })
    const input = {
      ideaId: 'idea1',
      workspaceId: 'w1',
      createdById: 'm1',
      url: 'https://www.figma.com/file/abc/F?node-id=1-2',
      fileKey: 'abc',
      nodeId: '1:2',
      fileName: 'F',
      frameName: 'Welcome',
    }
    await ideaFigmaLinkRepository.create(input)
    expect(create).toHaveBeenCalledWith({ data: input })
  })

  it('findByIdeaAndKey queries the unique ideaId_fileKey_nodeId tuple', async () => {
    const findUnique = prisma.ideaFigmaLink.findUnique as jest.Mock
    findUnique.mockResolvedValue(null)
    await ideaFigmaLinkRepository.findByIdeaAndKey('idea1', 'abc', '1:2')
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        ideaId_fileKey_nodeId: {
          ideaId: 'idea1',
          fileKey: 'abc',
          nodeId: '1:2',
        },
      },
    })
  })
})
