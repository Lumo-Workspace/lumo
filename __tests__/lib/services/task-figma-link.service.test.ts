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
