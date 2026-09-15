/** @jest-environment node */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services/idea-evidence-resolve', () => ({
  resolveIdeaRef: jest.fn(),
}))
jest.mock('@/lib/services/idea-slack-context.service', () => ({
  ideaSlackContextService: {
    listForIdea: jest.fn(),
    linkSlackPermalink: jest.fn(),
    refreshContext: jest.fn(),
    unlinkContext: jest.fn(),
  },
}))
jest.mock('@/lib/services/idea-web-link.service', () => ({
  ideaWebLinkService: {
    listForIdea: jest.fn(),
    addWebLink: jest.fn(),
    refreshWebLink: jest.fn(),
    unlinkWebLink: jest.fn(),
    fetchBody: jest.fn(),
  },
}))
jest.mock('@/lib/services/idea-figma-link.service', () => ({
  ideaFigmaLinkService: {
    listForIdea: jest.fn(),
    addFigmaLink: jest.fn(),
    removeFigmaLink: jest.fn(),
    refreshLinksForIdea: jest.fn(),
  },
}))
jest.mock('@/lib/repositories', () => ({
  ideaSlackContextRepository: { getById: jest.fn() },
  ideaWebLinkRepository: { getById: jest.fn() },
}))

import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveIdeaRef } from '@/lib/services/idea-evidence-resolve'
import { ideaSlackContextService } from '@/lib/services/idea-slack-context.service'
import { ideaWebLinkService } from '@/lib/services/idea-web-link.service'
import { ideaFigmaLinkService } from '@/lib/services/idea-figma-link.service'
import { ideaSlackContextRepository } from '@/lib/repositories'

import {
  GET as SLACK_GET,
  POST as SLACK_POST,
} from '@/app/api/ideas/[id]/slack-contexts/route'
import { DELETE as SLACK_DELETE } from '@/app/api/ideas/[id]/slack-contexts/[contextId]/route'
import { POST as SLACK_REFRESH } from '@/app/api/ideas/[id]/slack-contexts/[contextId]/refresh/route'
import { GET as SLACK_SNAPSHOT } from '@/app/api/ideas/[id]/slack-contexts/[contextId]/snapshot/route'

import {
  GET as WEB_GET,
  POST as WEB_POST,
} from '@/app/api/ideas/[id]/web-links/route'
import { DELETE as WEB_DELETE } from '@/app/api/ideas/[id]/web-links/[linkId]/route'
import { POST as WEB_REFRESH } from '@/app/api/ideas/[id]/web-links/[linkId]/refresh/route'
import { GET as WEB_BODY } from '@/app/api/ideas/[id]/web-links/[linkId]/body/route'

import {
  GET as FIGMA_GET,
  POST as FIGMA_POST,
} from '@/app/api/ideas/[id]/figma/route'
import { DELETE as FIGMA_DELETE } from '@/app/api/ideas/[id]/figma/[linkId]/route'
import { POST as FIGMA_REFRESH } from '@/app/api/ideas/[id]/figma/refresh/route'

const identityMock = requireIdentity as jest.Mock
const resolveMock = resolveIdeaRef as jest.Mock

const IDENTITY = {
  clerkId: 'u1',
  memberId: 'm1',
  workspaceId: 'w1',
  workspaceSlug: 'lumo',
  workspaceName: 'Lumo',
  source: 'bearer' as const,
}

const RESOLVED = { ideaId: 'i8', workspaceId: 'w1', teamId: 't1' }

const jsonReq = (body: unknown): NextRequest =>
  ({ json: async () => body }) as unknown as NextRequest

const malformedJsonReq = (): NextRequest =>
  ({
    json: async () => {
      throw new SyntaxError('Unexpected token in JSON')
    },
  }) as unknown as NextRequest

const paramsP = (p: Record<string, string>) =>
  ({ params: Promise.resolve(p) }) as { params: Promise<never> }

beforeEach(() => {
  jest.clearAllMocks()
  identityMock.mockResolvedValue(IDENTITY)
  resolveMock.mockResolvedValue(RESOLVED)
})

describe('GET /api/ideas/[id]/slack-contexts', () => {
  it('401 when unauthenticated', async () => {
    identityMock.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await SLACK_GET({} as NextRequest, paramsP({ id: 'LUM-I8' }))
    expect(res.status).toBe(401)
  })

  it('404 when idea in another team', async () => {
    resolveMock.mockRejectedValue(
      Object.assign(new Error('Idea not found'), { status: 404 })
    )
    const res = await SLACK_GET({} as NextRequest, paramsP({ id: 'LUM-I8' }))
    expect(res.status).toBe(404)
  })

  it('200 lists contexts', async () => {
    ;(ideaSlackContextService.listForIdea as jest.Mock).mockResolvedValue([
      { id: 'sc_1' },
    ])
    const res = await SLACK_GET({} as NextRequest, paramsP({ id: 'LUM-I8' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ contexts: [{ id: 'sc_1' }] })
    expect(ideaSlackContextService.listForIdea).toHaveBeenCalledWith('i8')
  })
})

describe('POST /api/ideas/[id]/slack-contexts', () => {
  it('400 on invalid body', async () => {
    const res = await SLACK_POST(jsonReq({}), paramsP({ id: 'LUM-I8' }))
    expect(res.status).toBe(400)
  })

  it('400 (not 500) on malformed JSON body', async () => {
    const res = await SLACK_POST(malformedJsonReq(), paramsP({ id: 'LUM-I8' }))
    expect(res.status).toBe(400)
  })

  it('201 links the permalink with resolved ids', async () => {
    ;(
      ideaSlackContextService.linkSlackPermalink as jest.Mock
    ).mockResolvedValue({ id: 'sc_1' })
    const res = await SLACK_POST(
      jsonReq({
        permalink: 'https://x.slack.com/archives/C1/p1234567890123456',
      }),
      paramsP({ id: 'LUM-I8' })
    )
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ context: { id: 'sc_1' } })
    expect(ideaSlackContextService.linkSlackPermalink).toHaveBeenCalledWith({
      ideaRef: 'LUM-I8',
      workspaceId: 'w1',
      permalink: 'https://x.slack.com/archives/C1/p1234567890123456',
      actorMemberId: 'm1',
    })
  })

  it('404 on cross-team idea (service resolves internally and throws)', async () => {
    ;(
      ideaSlackContextService.linkSlackPermalink as jest.Mock
    ).mockRejectedValue(
      Object.assign(new Error('Idea not found'), { status: 404 })
    )
    const res = await SLACK_POST(
      jsonReq({
        permalink: 'https://x.slack.com/archives/C1/p1234567890123456',
      }),
      paramsP({ id: 'LUM-I8' })
    )
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/ideas/[id]/slack-contexts/[contextId]', () => {
  it('204 on success', async () => {
    ;(ideaSlackContextService.unlinkContext as jest.Mock).mockResolvedValue(
      undefined
    )
    const res = await SLACK_DELETE(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8', contextId: 'sc_1' })
    )
    expect(res.status).toBe(204)
    expect(ideaSlackContextService.unlinkContext).toHaveBeenCalledWith(
      'sc_1',
      'w1'
    )
  })

  it('404 on cross-team idea', async () => {
    resolveMock.mockRejectedValue(
      Object.assign(new Error('Idea not found'), { status: 404 })
    )
    const res = await SLACK_DELETE(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8', contextId: 'sc_1' })
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /api/ideas/[id]/slack-contexts/[contextId]/refresh', () => {
  it('200 refreshes', async () => {
    ;(ideaSlackContextService.refreshContext as jest.Mock).mockResolvedValue({
      id: 'sc_1',
      snapshot: {},
    })
    const res = await SLACK_REFRESH(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8', contextId: 'sc_1' })
    )
    expect(res.status).toBe(200)
    expect(ideaSlackContextService.refreshContext).toHaveBeenCalledWith(
      'sc_1',
      'w1'
    )
  })
})

describe('GET /api/ideas/[id]/slack-contexts/[contextId]/snapshot', () => {
  it('200 returns snapshot scoped to idea', async () => {
    ;(ideaSlackContextRepository.getById as jest.Mock).mockResolvedValue({
      id: 'sc_1',
      ideaId: 'i8',
      snapshot: { messages: [] },
    })
    const res = await SLACK_SNAPSHOT(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8', contextId: 'sc_1' })
    )
    expect(res.status).toBe(200)
    // LUM-784: the tier-2 egress carries the redaction count beside the snapshot.
    expect(await res.json()).toEqual({
      snapshot: { messages: [] },
      redactedSecrets: 0,
    })
  })

  it('404 when snapshot belongs to a different idea', async () => {
    ;(ideaSlackContextRepository.getById as jest.Mock).mockResolvedValue({
      id: 'sc_1',
      ideaId: 'other_idea',
      snapshot: {},
    })
    const res = await SLACK_SNAPSHOT(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8', contextId: 'sc_1' })
    )
    expect(res.status).toBe(404)
  })

  it('404 when idea is cross-team', async () => {
    resolveMock.mockRejectedValue(
      Object.assign(new Error('Idea not found'), { status: 404 })
    )
    const res = await SLACK_SNAPSHOT(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8', contextId: 'sc_1' })
    )
    expect(res.status).toBe(404)
  })
})

describe('GET /api/ideas/[id]/web-links', () => {
  it('200 lists web links', async () => {
    ;(ideaWebLinkService.listForIdea as jest.Mock).mockResolvedValue([
      { id: 'wl_1' },
    ])
    const res = await WEB_GET({} as NextRequest, paramsP({ id: 'LUM-I8' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ webLinks: [{ id: 'wl_1' }] })
    expect(ideaWebLinkService.listForIdea).toHaveBeenCalledWith('i8')
  })
})

describe('POST /api/ideas/[id]/web-links', () => {
  it('400 on invalid body', async () => {
    const res = await WEB_POST(jsonReq({}), paramsP({ id: 'LUM-I8' }))
    expect(res.status).toBe(400)
  })

  it('400 (not 500) on malformed JSON body', async () => {
    const res = await WEB_POST(malformedJsonReq(), paramsP({ id: 'LUM-I8' }))
    expect(res.status).toBe(400)
  })

  it('201 with webLink on success and calls addWebLink with resolved ids', async () => {
    ;(ideaWebLinkService.addWebLink as jest.Mock).mockResolvedValue({
      id: 'wl_1',
      url: 'https://example.com/',
    })
    const res = await WEB_POST(
      jsonReq({ url: 'https://example.com/' }),
      paramsP({ id: 'LUM-I8' })
    )
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      webLink: { id: 'wl_1', url: 'https://example.com/' },
    })
    expect(ideaWebLinkService.addWebLink).toHaveBeenCalledWith({
      ideaRef: 'LUM-I8',
      workspaceId: 'w1',
      url: 'https://example.com/',
      actorMemberId: 'm1',
    })
  })

  it('404 when idea is cross-team/missing (service resolves internally and throws)', async () => {
    ;(ideaWebLinkService.addWebLink as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Idea not found'), { status: 404 })
    )
    const res = await WEB_POST(
      jsonReq({ url: 'https://example.com/' }),
      paramsP({ id: 'LUM-I8' })
    )
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/ideas/[id]/web-links/[linkId]', () => {
  it('204 on success', async () => {
    ;(ideaWebLinkService.unlinkWebLink as jest.Mock).mockResolvedValue(
      undefined
    )
    const res = await WEB_DELETE(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8', linkId: 'wl_1' })
    )
    expect(res.status).toBe(204)
    expect(ideaWebLinkService.unlinkWebLink).toHaveBeenCalledWith('wl_1', 'w1')
  })
})

describe('POST /api/ideas/[id]/web-links/[linkId]/refresh', () => {
  it('200 returns refreshed webLink', async () => {
    ;(ideaWebLinkService.refreshWebLink as jest.Mock).mockResolvedValue({
      id: 'wl_1',
      title: 'Updated',
    })
    const res = await WEB_REFRESH(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8', linkId: 'wl_1' })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      webLink: { id: 'wl_1', title: 'Updated' },
    })
  })
})

describe('GET /api/ideas/[id]/web-links/[linkId]/body', () => {
  it('200 returns body', async () => {
    ;(ideaWebLinkService.fetchBody as jest.Mock).mockResolvedValue('body text')
    const res = await WEB_BODY(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8', linkId: 'wl_1' })
    )
    expect(res.status).toBe(200)
    // LUM-784: the tier-2 egress carries the redaction count beside the body.
    expect(await res.json()).toEqual({ body: 'body text', redactedSecrets: 0 })
    expect(ideaWebLinkService.fetchBody).toHaveBeenCalledWith('w1', 'wl_1')
  })

  it('404 when idea is cross-team', async () => {
    resolveMock.mockRejectedValue(
      Object.assign(new Error('Idea not found'), { status: 404 })
    )
    const res = await WEB_BODY(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8', linkId: 'wl_1' })
    )
    expect(res.status).toBe(404)
  })
})

describe('GET /api/ideas/[id]/figma', () => {
  it('200 lists figma links', async () => {
    ;(ideaFigmaLinkService.listForIdea as jest.Mock).mockResolvedValue([
      { id: 'fl_1' },
    ])
    const res = await FIGMA_GET({} as NextRequest, paramsP({ id: 'LUM-I8' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ links: [{ id: 'fl_1' }] })
    expect(ideaFigmaLinkService.listForIdea).toHaveBeenCalledWith('i8')
  })
})

describe('POST /api/ideas/[id]/figma', () => {
  it('400 on invalid body', async () => {
    const res = await FIGMA_POST(jsonReq({}), paramsP({ id: 'LUM-I8' }))
    expect(res.status).toBe(400)
  })

  it('201 with link on success and calls addFigmaLink with resolved ids', async () => {
    ;(ideaFigmaLinkService.addFigmaLink as jest.Mock).mockResolvedValue({
      id: 'fl_1',
    })
    const res = await FIGMA_POST(
      jsonReq({ url: 'https://www.figma.com/file/abc123/Foo' }),
      paramsP({ id: 'LUM-I8' })
    )
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ link: { id: 'fl_1' } })
    expect(ideaFigmaLinkService.addFigmaLink).toHaveBeenCalledWith({
      ideaRef: 'LUM-I8',
      workspaceId: 'w1',
      actorMemberId: 'm1',
      url: 'https://www.figma.com/file/abc123/Foo',
    })
  })

  it('404 when idea is cross-team (service resolves internally and throws)', async () => {
    ;(ideaFigmaLinkService.addFigmaLink as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Idea not found'), { status: 404 })
    )
    const res = await FIGMA_POST(
      jsonReq({ url: 'https://www.figma.com/file/abc123/Foo' }),
      paramsP({ id: 'LUM-I8' })
    )
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/ideas/[id]/figma/[linkId]', () => {
  it('200 ok:true on success', async () => {
    ;(ideaFigmaLinkService.removeFigmaLink as jest.Mock).mockResolvedValue(
      undefined
    )
    const res = await FIGMA_DELETE(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8', linkId: 'fl_1' })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(ideaFigmaLinkService.removeFigmaLink).toHaveBeenCalledWith({
      input: 'fl_1',
      ideaId: 'i8',
    })
  })

  it('404 when idea is cross-team', async () => {
    resolveMock.mockRejectedValue(
      Object.assign(new Error('Idea not found'), { status: 404 })
    )
    const res = await FIGMA_DELETE(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8', linkId: 'fl_1' })
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /api/ideas/[id]/figma/refresh', () => {
  it('200 returns results', async () => {
    ;(ideaFigmaLinkService.refreshLinksForIdea as jest.Mock).mockResolvedValue([
      { id: 'fl_1', ok: true },
    ])
    const res = await FIGMA_REFRESH(
      {} as NextRequest,
      paramsP({ id: 'LUM-I8' })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results: [{ id: 'fl_1', ok: true }] })
    expect(ideaFigmaLinkService.refreshLinksForIdea).toHaveBeenCalledWith({
      ideaId: 'i8',
      workspaceId: 'w1',
      actorMemberId: 'm1',
    })
  })
})
