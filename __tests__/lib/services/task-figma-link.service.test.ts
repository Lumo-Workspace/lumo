import { taskFigmaLinkService } from '@/lib/services/task-figma-link.service'
import { taskFigmaLinkRepository } from '@/lib/repositories/task-figma-link.repository'
import * as integrationSvc from '@/lib/services/figma-integration.service'
import * as figmaClient from '@/lib/integrations/figma/client'

jest.mock('@/lib/repositories/task-figma-link.repository')
jest.mock('@/lib/services/figma-integration.service')
jest.mock('@/lib/integrations/figma/client')

const mockRepo = taskFigmaLinkRepository as jest.Mocked<
  typeof taskFigmaLinkRepository
>

function mockClient(overrides: Partial<figmaClient.FigmaClient> = {}) {
  const stub: figmaClient.FigmaClient = {
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
    getNode: jest.fn().mockResolvedValue({
      nodes: { '1:2': { document: { name: 'Welcome screen', type: 'FRAME' } } },
    }),
    getImage: jest.fn().mockResolvedValue('https://thumb.example/1.png'),
    ...overrides,
  }
  ;(figmaClient.createFigmaClient as jest.Mock).mockReturnValue(stub)
  return stub
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(integrationSvc.getDecryptedTokens as jest.Mock).mockResolvedValue({
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: new Date(Date.now() + 3600_000),
    integrationId: 'int_1',
  })
})

describe('addFigmaLink — happy path with node-id', () => {
  it('parses URL, fetches metadata, creates row', async () => {
    mockClient()
    mockRepo.findByTaskAndKey.mockResolvedValue(null)
    mockRepo.create.mockResolvedValue({ id: 'cfl_1' } as any)

    const result = await taskFigmaLinkService.addFigmaLink({
      taskId: 't1',
      workspaceId: 'w1',
      actorMemberId: 'm1',
      url: 'https://www.figma.com/file/abc/F?node-id=1-2',
    })

    expect(result).toEqual({ id: 'cfl_1' })
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't1',
        workspaceId: 'w1',
        createdById: 'm1',
        fileKey: 'abc',
        nodeId: '1:2',
        fileName: 'My File',
        frameName: 'Welcome screen',
        thumbnailUrl: 'https://thumb.example/1.png',
        integrationId: 'int_1',
      })
    )
  })
})

describe('addFigmaLink — file-level URL (no node-id)', () => {
  it('stores nodeId = "", frameName = null, thumbnail from picked frame', async () => {
    const stub = mockClient()
    mockRepo.findByTaskAndKey.mockResolvedValue(null)
    mockRepo.create.mockResolvedValue({ id: 'cfl_2' } as any)

    await taskFigmaLinkService.addFigmaLink({
      taskId: 't1',
      workspaceId: 'w1',
      actorMemberId: 'm1',
      url: 'https://www.figma.com/file/abc/F',
    })

    expect(stub.getNode).not.toHaveBeenCalled()
    expect(stub.getImage).toHaveBeenCalledWith('abc', '10:20')
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: '', frameName: null })
    )
  })
})

describe('addFigmaLink — idempotency', () => {
  it('returns existing row without calling Figma when lastSyncedAt < 7 days', async () => {
    const stub = mockClient()
    const fresh = {
      id: 'cfl_existing',
      lastSyncedAt: new Date(Date.now() - 1000),
    } as any
    mockRepo.findByTaskAndKey.mockResolvedValue(fresh)

    const result = await taskFigmaLinkService.addFigmaLink({
      taskId: 't1',
      workspaceId: 'w1',
      actorMemberId: 'm1',
      url: 'https://www.figma.com/file/abc/F?node-id=1-2',
    })

    expect(result).toBe(fresh)
    expect(stub.getFile).not.toHaveBeenCalled()
  })

  it('force-refreshes when lastSyncedAt > 7 days', async () => {
    const stub = mockClient()
    const stale = {
      id: 'cfl_stale',
      lastSyncedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000),
    } as any
    mockRepo.findByTaskAndKey.mockResolvedValue(stale)
    mockRepo.update.mockResolvedValue({ id: 'cfl_stale' } as any)

    await taskFigmaLinkService.addFigmaLink({
      taskId: 't1',
      workspaceId: 'w1',
      actorMemberId: 'm1',
      url: 'https://www.figma.com/file/abc/F?node-id=1-2',
    })

    expect(stub.getFile).toHaveBeenCalled()
    expect(mockRepo.update).toHaveBeenCalled()
  })
})

describe('addFigmaLink — failure modes', () => {
  it('throws 422 on non-Figma URL', async () => {
    await expect(
      taskFigmaLinkService.addFigmaLink({
        taskId: 't1',
        workspaceId: 'w1',
        actorMemberId: 'm1',
        url: 'https://example.com/x',
      })
    ).rejects.toMatchObject({ status: 422 })
  })

  it('throws 403 with figma_not_connected when no integration', async () => {
    ;(integrationSvc.getDecryptedTokens as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Figma not connected'), {
        status: 403,
        code: 'figma_not_connected',
      })
    )

    await expect(
      taskFigmaLinkService.addFigmaLink({
        taskId: 't1',
        workspaceId: 'w1',
        actorMemberId: 'm1',
        url: 'https://www.figma.com/file/abc/F',
      })
    ).rejects.toMatchObject({ status: 403, code: 'figma_not_connected' })
  })

  it('throws 403 with figma_needs_reauth when integration is invalidated', async () => {
    ;(integrationSvc.getDecryptedTokens as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Figma needs reauth'), {
        status: 403,
        code: 'figma_needs_reauth',
      })
    )

    await expect(
      taskFigmaLinkService.addFigmaLink({
        taskId: 't1',
        workspaceId: 'w1',
        actorMemberId: 'm1',
        url: 'https://www.figma.com/file/abc/F',
      })
    ).rejects.toMatchObject({ status: 403, code: 'figma_needs_reauth' })
  })

  it('writes row with thumbnail_failed when image API fails', async () => {
    mockClient({
      getImage: jest.fn().mockRejectedValue(new Error('boom')),
    })
    mockRepo.findByTaskAndKey.mockResolvedValue(null)
    mockRepo.create.mockResolvedValue({ id: 'cfl_3' } as any)

    await taskFigmaLinkService.addFigmaLink({
      taskId: 't1',
      workspaceId: 'w1',
      actorMemberId: 'm1',
      url: 'https://www.figma.com/file/abc/F?node-id=1-2',
    })

    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        thumbnailUrl: null,
        lastSyncError: 'thumbnail_failed',
      })
    )
  })
})

describe('listForTask', () => {
  it('returns rows in createdAt asc', async () => {
    mockRepo.listByTask.mockResolvedValue([{ id: 'a' }, { id: 'b' }] as any)
    const result = await taskFigmaLinkService.listForTask('t1')
    expect(result.map(r => r.id)).toEqual(['a', 'b'])
    expect(mockRepo.listByTask).toHaveBeenCalledWith('t1')
  })
})

describe('removeFigmaLink', () => {
  it('looks up by cuid and deletes', async () => {
    mockRepo.findById.mockResolvedValue({ id: 'cfl_x', taskId: 't1' } as any)
    await taskFigmaLinkService.removeFigmaLink({
      input: 'cfl_x',
      taskId: 't1',
    })
    expect(mockRepo.delete).toHaveBeenCalledWith('cfl_x')
  })

  it('resolves URL to (fileKey,nodeId) and deletes', async () => {
    mockRepo.findByTaskAndKey.mockResolvedValue({ id: 'cfl_y' } as any)
    await taskFigmaLinkService.removeFigmaLink({
      input: 'https://www.figma.com/file/abc/F?node-id=1-2',
      taskId: 't1',
    })
    expect(mockRepo.findByTaskAndKey).toHaveBeenCalledWith('t1', 'abc', '1:2')
    expect(mockRepo.delete).toHaveBeenCalledWith('cfl_y')
  })
})

describe('refreshLinksForTask', () => {
  it('refreshes all links, isolating per-link failures', async () => {
    mockRepo.listByTask.mockResolvedValue([
      {
        id: 'a',
        fileKey: 'k1',
        nodeId: '1:2',
        taskId: 't1',
        workspaceId: 'w1',
      },
      {
        id: 'b',
        fileKey: 'k2',
        nodeId: '',
        taskId: 't1',
        workspaceId: 'w1',
      },
    ] as any)
    const stub = mockClient()
    ;(stub.getFile as jest.Mock)
      .mockResolvedValueOnce({
        name: 'F1',
        document: { children: [] },
      })
      .mockRejectedValueOnce(new Error('404'))
    mockRepo.update.mockResolvedValue({} as any)

    const result = await taskFigmaLinkService.refreshLinksForTask({
      taskId: 't1',
      workspaceId: 'w1',
      actorMemberId: 'm1',
    })

    expect(result).toEqual([
      { id: 'a', ok: true },
      { id: 'b', ok: false, error: expect.any(String) },
    ])
  })
})
