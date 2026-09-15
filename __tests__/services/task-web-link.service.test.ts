/** @jest-environment node */
jest.mock('@/lib/repositories/task-web-link.repository', () => ({
  taskWebLinkRepository: {
    create: jest.fn(),
    listByTask: jest.fn(),
    getById: jest.fn(),
    updateFetch: jest.fn(),
    updateBody: jest.fn(),
    delete: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/og-metadata/fetch', () => ({
  fetchOpenGraph: jest.fn(),
}))
jest.mock('@/lib/integrations/og-metadata/fetch-chromium', () => ({
  fetchOpenGraphChromium: jest.fn(),
}))
jest.mock('@/lib/integrations/og-metadata/ssrf', () => ({
  assertExternalHost: jest.fn(),
}))

import { taskWebLinkRepository } from '@/lib/repositories/task-web-link.repository'
import { fetchOpenGraph } from '@/lib/integrations/og-metadata/fetch'
import { fetchOpenGraphChromium } from '@/lib/integrations/og-metadata/fetch-chromium'
import { assertExternalHost } from '@/lib/integrations/og-metadata/ssrf'
import { taskWebLinkService } from '@/lib/services/task-web-link.service'

const repoCreate = taskWebLinkRepository.create as jest.Mock
const repoListByTask = taskWebLinkRepository.listByTask as jest.Mock
const repoGetById = taskWebLinkRepository.getById as jest.Mock
const repoUpdateFetch = taskWebLinkRepository.updateFetch as jest.Mock
const repoUpdateBody = taskWebLinkRepository.updateBody as jest.Mock
const repoDelete = taskWebLinkRepository.delete as jest.Mock
const ogMock = fetchOpenGraph as jest.Mock
const chromiumMock = fetchOpenGraphChromium as jest.Mock
const assertExternalHostMock = assertExternalHost as jest.Mock

beforeEach(() => jest.clearAllMocks())

const baseInput: import('@/lib/services/task-web-link.service').AddWebLinkInput =
  {
    taskId: 'tsk_1',
    workspaceId: 'ws_1',
    url: 'HTTPS://Example.COM/path?x=1#frag',
    actorMemberId: 'mem_1',
  }

describe('taskWebLinkService.addWebLink', () => {
  it('normalizes URL (lowercase scheme/host, strips fragment) before storing', async () => {
    ogMock.mockResolvedValue({ ok: false, error: 'http 404' }) // non-escalating
    repoCreate.mockResolvedValue({ id: 'wl_1' })
    await taskWebLinkService.addWebLink(baseInput)
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/path?x=1',
        domain: 'example.com',
      })
    )
    expect(chromiumMock).not.toHaveBeenCalled()
  })

  it('writes OG fields on fetch success', async () => {
    ogMock.mockResolvedValue({
      ok: true,
      data: {
        title: 'Hi',
        description: 'There',
        imageUrl: 'https://example.com/i.png',
        faviconUrl: 'https://example.com/f.ico',
      },
      finalUrl: 'https://example.com/path?x=1',
    })
    repoCreate.mockResolvedValue({ id: 'wl_1' })
    await taskWebLinkService.addWebLink(baseInput)
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Hi',
        description: 'There',
        imageUrl: 'https://example.com/i.png',
        faviconUrl: 'https://example.com/f.ico',
        fetchedAt: expect.any(Date),
        fetchError: null,
      })
    )
  })

  it('writes nulls + fetchError on fetch failure (still stores the row)', async () => {
    ogMock.mockResolvedValue({ ok: false, error: 'http 404' })
    repoCreate.mockResolvedValue({ id: 'wl_1' })
    await taskWebLinkService.addWebLink(baseInput)
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: null,
        description: null,
        imageUrl: null,
        faviconUrl: null,
        fetchedAt: null,
        fetchError: 'http 404',
      })
    )
  })

  it('always writes note as null (note input dropped from API)', async () => {
    ogMock.mockResolvedValue({
      ok: true,
      data: { description: 'OG says this' },
      finalUrl: 'https://example.com/',
    })
    repoCreate.mockResolvedValue({ id: 'wl_1' })
    await taskWebLinkService.addWebLink(baseInput)
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        note: null,
        description: 'OG says this',
      })
    )
  })

  it('uses actorMemberId for createdById', async () => {
    ogMock.mockResolvedValue({ ok: false, error: 'x' })
    repoCreate.mockResolvedValue({ id: 'wl_1' })
    await taskWebLinkService.addWebLink(baseInput)
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({ createdById: 'mem_1' })
    )
  })

  it('does not call chromium when fast fetch succeeds', async () => {
    ogMock.mockResolvedValue({
      ok: true,
      data: { title: 't', description: 'd', imageUrl: 'i', faviconUrl: 'f' },
      finalUrl: 'https://example.com/path?x=1',
    })
    repoCreate.mockResolvedValue({ id: 'wl_ok' })
    await taskWebLinkService.addWebLink(baseInput)
    expect(chromiumMock).not.toHaveBeenCalled()
  })

  it('escalates to chromium on block signal and writes success', async () => {
    ogMock.mockResolvedValue({ ok: false, error: 'http 403' })
    chromiumMock.mockResolvedValue({
      ok: true,
      data: {
        title: 'Real',
        description: 'desc',
        imageUrl: 'https://x.test/i.png',
        faviconUrl: 'https://x.test/f.ico',
      },
      finalUrl: 'https://example.com/path?x=1',
    })
    repoCreate.mockResolvedValue({ id: 'wl_cr' })
    await taskWebLinkService.addWebLink(baseInput)
    expect(chromiumMock).toHaveBeenCalledWith('https://example.com/path?x=1')
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Real',
        description: 'desc',
        imageUrl: 'https://x.test/i.png',
        faviconUrl: 'https://x.test/f.ico',
        fetchedAt: expect.any(Date),
        fetchError: null,
      })
    )
  })

  it('writes chromium failure error when chromium also fails', async () => {
    ogMock.mockResolvedValue({ ok: false, error: 'http 403' })
    chromiumMock.mockResolvedValue({
      ok: false,
      error: 'chromium: timeout',
    })
    repoCreate.mockResolvedValue({ id: 'wl_fail' })
    await taskWebLinkService.addWebLink(baseInput)
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: null,
        fetchedAt: null,
        fetchError: 'chromium: timeout',
      })
    )
  })

  it('does not escalate on non-block-signal failures', async () => {
    ogMock.mockResolvedValue({ ok: false, error: 'http 404' })
    repoCreate.mockResolvedValue({ id: 'wl_404' })
    await taskWebLinkService.addWebLink(baseInput)
    expect(chromiumMock).not.toHaveBeenCalled()
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({ fetchError: 'http 404' })
    )
  })

  it('escalates on "empty extraction" (200 + html with no title)', async () => {
    // Real-world example: guide.michelin.com returns 200 + JS shell with no
    // meaningful <head> metadata. fetch.ts treats that as 'empty extraction'
    // and the classifier escalates to Chromium.
    ogMock.mockResolvedValue({ ok: false, error: 'empty extraction' })
    chromiumMock.mockResolvedValue({
      ok: true,
      data: {
        title: 'After-render Title',
        description: 'd',
        imageUrl: undefined,
        faviconUrl: undefined,
      },
      finalUrl: 'https://example.com/path?x=1',
    })
    repoCreate.mockResolvedValue({ id: 'wl_empty' })
    await taskWebLinkService.addWebLink(baseInput)
    expect(chromiumMock).toHaveBeenCalled()
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'After-render Title',
        fetchError: null,
      })
    )
  })

  it('escalates on "body too large" (oversize fast response)', async () => {
    // CNN-class sites ship >10MB of HTML. The fast fetcher gives up; Chromium
    // parses the rendered DOM and isn't bound by our body cap.
    ogMock.mockResolvedValue({ ok: false, error: 'body too large' })
    chromiumMock.mockResolvedValue({
      ok: true,
      data: {
        title: 'Big page title',
        description: undefined,
        imageUrl: undefined,
        faviconUrl: undefined,
      },
      finalUrl: 'https://example.com/path?x=1',
    })
    repoCreate.mockResolvedValue({ id: 'wl_big' })
    await taskWebLinkService.addWebLink(baseInput)
    expect(chromiumMock).toHaveBeenCalled()
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Big page title' })
    )
  })
})

describe('taskWebLinkService.refreshWebLink', () => {
  it('throws 404 if link not found', async () => {
    repoGetById.mockResolvedValue(null)
    await expect(
      taskWebLinkService.refreshWebLink('wl_X', 'ws_1')
    ).rejects.toMatchObject({ message: 'not_found', status: 404 })
  })

  it('throws 404 if link belongs to a different workspace', async () => {
    repoGetById.mockResolvedValue({
      id: 'wl_1',
      url: 'https://example.com/',
      task: { project: { workspaceId: 'ws_OTHER' } },
    })
    await expect(
      taskWebLinkService.refreshWebLink('wl_1', 'ws_1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('on fetch success: updates OG fields and clears fetchError', async () => {
    repoGetById.mockResolvedValue({
      id: 'wl_1',
      url: 'https://example.com/',
      task: { project: { workspaceId: 'ws_1' } },
    })
    ogMock.mockResolvedValue({
      ok: true,
      data: { title: 'Refreshed' },
      finalUrl: 'https://example.com/',
    })
    repoUpdateFetch.mockResolvedValue({ id: 'wl_1' })
    await taskWebLinkService.refreshWebLink('wl_1', 'ws_1')
    expect(repoUpdateFetch).toHaveBeenCalledWith('wl_1', {
      ok: true,
      title: 'Refreshed',
      description: undefined,
      imageUrl: undefined,
      faviconUrl: undefined,
      // LUM-783: refreshed metadata is re-scanned; clean → null.
      contentSignals: null,
    })
  })

  it('on fetch failure: writes fetchError (preserves OG fields)', async () => {
    repoGetById.mockResolvedValue({
      id: 'wl_1',
      url: 'https://example.com/',
      task: { project: { workspaceId: 'ws_1' } },
    })
    ogMock.mockResolvedValue({ ok: false, error: 'http 404' })
    repoUpdateFetch.mockResolvedValue({ id: 'wl_1' })
    await taskWebLinkService.refreshWebLink('wl_1', 'ws_1')
    expect(repoUpdateFetch).toHaveBeenCalledWith('wl_1', {
      ok: false,
      error: 'http 404',
    })
  })

  it('escalates to chromium on refresh when fast returns block signal', async () => {
    repoGetById.mockResolvedValue({
      id: 'wl_1',
      url: 'https://blocked.test/x',
      task: { project: { workspaceId: 'ws_1' } },
    })
    ogMock.mockResolvedValue({ ok: false, error: 'http 403' })
    chromiumMock.mockResolvedValue({
      ok: true,
      data: {
        title: 'After',
        description: 'desc',
        imageUrl: undefined,
        faviconUrl: undefined,
      },
      finalUrl: 'https://blocked.test/x',
    })
    repoUpdateFetch.mockResolvedValue({ id: 'wl_1' })
    await taskWebLinkService.refreshWebLink('wl_1', 'ws_1')
    expect(chromiumMock).toHaveBeenCalledWith('https://blocked.test/x')
    expect(repoUpdateFetch).toHaveBeenCalledWith(
      'wl_1',
      expect.objectContaining({ ok: true, title: 'After' })
    )
  })
})

describe('taskWebLinkService.unlinkWebLink', () => {
  it('throws 404 if not found', async () => {
    repoGetById.mockResolvedValue(null)
    await expect(
      taskWebLinkService.unlinkWebLink('wl_X', 'ws_1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 404 if link belongs to a different workspace', async () => {
    repoGetById.mockResolvedValue({
      id: 'wl_1',
      task: { project: { workspaceId: 'ws_OTHER' } },
    })
    await expect(
      taskWebLinkService.unlinkWebLink('wl_1', 'ws_1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('deletes when workspace matches', async () => {
    repoGetById.mockResolvedValue({
      id: 'wl_1',
      task: { project: { workspaceId: 'ws_1' } },
    })
    repoDelete.mockResolvedValue({})
    await taskWebLinkService.unlinkWebLink('wl_1', 'ws_1')
    expect(repoDelete).toHaveBeenCalledWith('wl_1')
  })
})

describe('taskWebLinkService.listForTask', () => {
  it('delegates to repo.listByTask', async () => {
    repoListByTask.mockResolvedValue([{ id: 'wl_1' }])
    const result = await taskWebLinkService.listForTask('tsk_1')
    expect(result).toEqual([{ id: 'wl_1' }])
    expect(repoListByTask).toHaveBeenCalledWith('tsk_1')
  })
})

describe('taskWebLinkService.fetchBody', () => {
  const globalFetch = jest.fn()

  beforeEach(() => {
    globalFetch.mockReset()

    global.fetch = globalFetch as any
  })

  it('calls assertExternalHost before fetching when body is missing', async () => {
    repoGetById.mockResolvedValue({
      id: 'wl_1',
      url: 'https://example.com/article',
      body: null,
      task: { project: { workspaceId: 'ws_1' } },
    })
    globalFetch.mockResolvedValue({
      text: async () => '<html><body><p>Hello world</p></body></html>',
    })
    repoUpdateBody.mockResolvedValue({ id: 'wl_1' })

    await taskWebLinkService.fetchBody('ws_1', 'wl_1')

    expect(assertExternalHostMock).toHaveBeenCalledWith(
      'https://example.com/article'
    )
    // SSRF guard must run before the outbound fetch.
    const assertOrder = assertExternalHostMock.mock.invocationCallOrder[0]!
    const fetchOrder = globalFetch.mock.invocationCallOrder[0]!
    expect(assertOrder).toBeLessThan(fetchOrder)
    expect(repoUpdateBody).toHaveBeenCalledWith(
      'wl_1',
      expect.stringContaining('Hello world'),
      // LUM-783: the fetched body is scanned; clean → null.
      null
    )
  })

  it('returns stored body without fetching or running SSRF guard', async () => {
    repoGetById.mockResolvedValue({
      id: 'wl_1',
      url: 'https://example.com/article',
      body: 'already cached body',
      task: { project: { workspaceId: 'ws_1' } },
    })

    const result = await taskWebLinkService.fetchBody('ws_1', 'wl_1')

    expect(result).toBe('already cached body')
    expect(assertExternalHostMock).not.toHaveBeenCalled()
    expect(globalFetch).not.toHaveBeenCalled()
    expect(repoUpdateBody).not.toHaveBeenCalled()
  })

  it('throws 404 when the link belongs to a different workspace', async () => {
    repoGetById.mockResolvedValue({
      id: 'wl_1',
      url: 'https://example.com/article',
      body: null,
      task: { project: { workspaceId: 'ws_OTHER' } },
    })

    await expect(
      taskWebLinkService.fetchBody('ws_1', 'wl_1')
    ).rejects.toMatchObject({ message: 'not_found', status: 404 })
    expect(assertExternalHostMock).not.toHaveBeenCalled()
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('throws 404 when the link is not found', async () => {
    repoGetById.mockResolvedValue(null)

    await expect(
      taskWebLinkService.fetchBody('ws_1', 'wl_X')
    ).rejects.toMatchObject({ status: 404 })
    expect(assertExternalHostMock).not.toHaveBeenCalled()
  })
})
