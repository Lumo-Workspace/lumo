/** @jest-environment node */
jest.mock('@/lib/repositories/idea-web-link.repository', () => ({
  ideaWebLinkRepository: {
    create: jest.fn(),
    listByIdea: jest.fn(),
    getById: jest.fn(),
    updateFetch: jest.fn(),
    updateBody: jest.fn(),
    delete: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/idea-slack-context.repository', () => ({
  ideaSlackContextRepository: {
    create: jest.fn(),
    listByIdea: jest.fn(),
    getById: jest.fn(),
    updateSnapshot: jest.fn(),
    updateSummary: jest.fn(),
    delete: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/idea-figma-link.repository', () => ({
  ideaFigmaLinkRepository: {
    create: jest.fn(),
    listByIdea: jest.fn(),
    findById: jest.fn(),
    findByIdeaAndKey: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}))
jest.mock('@/lib/services/idea-evidence-resolve', () => ({
  resolveIdeaRef: jest.fn(),
}))
jest.mock('@/lib/integrations/og-metadata/fetch-with-fallback', () => ({
  fetchWithFallback: jest.fn(),
  normalizeUrl: jest.fn((raw: string) => {
    const u = new URL(raw.trim())
    u.hash = ''
    return { url: u.toString(), domain: u.hostname }
  }),
}))
jest.mock('@/lib/integrations/slack/token', () => ({
  getSlackIntegrationToken: jest.fn(),
}))
jest.mock('@/lib/integrations/slack/context-fetcher', () => ({
  fetchSingleMessage: jest.fn(),
  fetchThread: jest.fn(),
  resolveUsers: jest.fn(),
  resolveChannelName: jest.fn(),
  toSnapshot: jest.fn((raw, users) => ({
    messages: raw.map((m: { ts: string; user: string; text: string }) => ({
      ts: m.ts,
      userId: m.user,
      userName: users.get(m.user)?.name ?? null,
      userAvatarUrl: null,
      text: m.text,
      edited: false,
    })),
  })),
  SlackApiError: class SlackApiError extends Error {
    constructor(
      public code: string,
      msg?: string
    ) {
      super(msg ?? code)
    }
  },
}))
jest.mock('@/lib/integrations/figma/build-client', () => ({
  buildFigmaClient: jest.fn(),
  pickRepresentativeFrame: jest.fn(() => ({ id: '10:20', name: 'Cover' })),
}))

import { ideaWebLinkService } from '@/lib/services/idea-web-link.service'
import { ideaSlackContextService } from '@/lib/services/idea-slack-context.service'
import { ideaFigmaLinkService } from '@/lib/services/idea-figma-link.service'
import { ideaWebLinkRepository } from '@/lib/repositories/idea-web-link.repository'
import { ideaSlackContextRepository } from '@/lib/repositories/idea-slack-context.repository'
import { ideaFigmaLinkRepository } from '@/lib/repositories/idea-figma-link.repository'
import { resolveIdeaRef } from '@/lib/services/idea-evidence-resolve'
import { fetchWithFallback } from '@/lib/integrations/og-metadata/fetch-with-fallback'
import {
  fetchThread,
  resolveUsers,
  resolveChannelName,
} from '@/lib/integrations/slack/context-fetcher'
import { getSlackIntegrationToken } from '@/lib/integrations/slack/token'
import { buildFigmaClient } from '@/lib/integrations/figma/build-client'

const resolveIdeaRefMock = resolveIdeaRef as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  resolveIdeaRefMock.mockResolvedValue({
    ideaId: 'idea1',
    workspaceId: 'w',
    teamId: 'team1',
  })
})

describe('idea evidence services', () => {
  it('idea evidence: slack/web/figma persist and list back', async () => {
    // web
    ;(fetchWithFallback as jest.Mock).mockResolvedValue({
      ok: true,
      data: {
        title: 'A title',
        description: 'A desc',
        imageUrl: null,
        faviconUrl: null,
      },
    })
    ;(ideaWebLinkRepository.create as jest.Mock).mockResolvedValue({
      id: 'w1',
      ideaId: 'idea1',
    })
    ;(ideaWebLinkRepository.listByIdea as jest.Mock).mockResolvedValue([
      { id: 'w1' },
    ])

    const web = await ideaWebLinkService.addWebLink({
      ideaRef: 'LUM-I1',
      workspaceId: 'w',
      url: 'https://a.com',
      actorMemberId: 'm1',
    })
    expect(web.ideaId).toBe('idea1')
    expect(ideaWebLinkRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ ideaId: 'idea1', createdById: 'm1' })
    )
    expect(await ideaWebLinkService.listForIdea('idea1')).toHaveLength(1)

    // slack
    ;(getSlackIntegrationToken as jest.Mock).mockResolvedValue({
      token: 'tok',
      slackTeamId: 'T1',
      slackTeamName: 'lumo',
    })
    ;(fetchThread as jest.Mock).mockResolvedValue([
      { ts: '1700000000.000100', user: 'U1', text: 'hi' },
    ])
    ;(resolveUsers as jest.Mock).mockResolvedValue(
      new Map([['U1', { name: 'alice', avatarUrl: null }]])
    )
    ;(resolveChannelName as jest.Mock).mockResolvedValue('design')
    ;(ideaSlackContextRepository.create as jest.Mock).mockResolvedValue({
      id: 's1',
      ideaId: 'idea1',
    })
    ;(ideaSlackContextRepository.listByIdea as jest.Mock).mockResolvedValue([
      { id: 's1' },
    ])

    const slack = await ideaSlackContextService.linkSlackPermalink({
      ideaRef: 'LUM-I1',
      workspaceId: 'w',
      permalink:
        'https://lumo.slack.com/archives/C9/p1700000000000200?thread_ts=1700000000.000100&cid=C9',
      actorMemberId: 'm1',
    })
    expect(slack.ideaId).toBe('idea1')
    expect(ideaSlackContextRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ ideaId: 'idea1', createdById: 'm1' })
    )
    expect(await ideaSlackContextService.listForIdea('idea1')).toHaveLength(1)

    // figma
    ;(buildFigmaClient as jest.Mock).mockResolvedValue({
      client: {
        getFile: jest.fn().mockResolvedValue({
          name: 'My File',
          document: {
            children: [
              {
                type: 'CANVAS',
                children: [{ id: '10:20', name: 'Cover', type: 'FRAME' }],
              },
            ],
          },
        }),
        getNode: jest.fn(),
        getImage: jest.fn().mockResolvedValue('https://thumb.example/1.png'),
      },
      integrationId: 'int_1',
    })
    ;(ideaFigmaLinkRepository.findByIdeaAndKey as jest.Mock).mockResolvedValue(
      null
    )
    ;(ideaFigmaLinkRepository.create as jest.Mock).mockResolvedValue({
      id: 'f1',
      ideaId: 'idea1',
    })
    ;(ideaFigmaLinkRepository.listByIdea as jest.Mock).mockResolvedValue([
      { id: 'f1' },
    ])

    const figma = await ideaFigmaLinkService.addFigmaLink({
      ideaRef: 'LUM-I1',
      workspaceId: 'w',
      actorMemberId: 'm1',
      url: 'https://www.figma.com/file/abc/F',
    })
    expect(figma.ideaId).toBe('idea1')
    expect(ideaFigmaLinkRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ ideaId: 'idea1', createdById: 'm1' })
    )
    expect(await ideaFigmaLinkService.listForIdea('idea1')).toHaveLength(1)
  })
})
