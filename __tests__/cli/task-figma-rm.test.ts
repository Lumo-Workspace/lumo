/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/figma-api', () => ({
  listFigmaLinks: jest.fn(),
  removeFigmaLink: jest.fn(),
}))

import { listFigmaLinks, removeFigmaLink } from '@/cli/src/lib/figma-api'
import { taskFigmaRm } from '@/cli/src/commands/task-figma-rm'

const mockList = listFigmaLinks as jest.Mock
const mockRm = removeFigmaLink as jest.Mock

let logSpy: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => logSpy.mockRestore())

const links = [
  {
    id: 'cfl_a',
    fileKey: 'abc',
    nodeId: '1:2',
    url: 'https://www.figma.com/file/abc/F?node-id=1-2',
    fileName: 'Onboarding',
    frameName: 'Welcome',
    thumbnailUrl: null,
    thumbnailFetchedAt: null,
    lastSyncedAt: '2026-05-28T00:00:00Z',
    lastSyncError: null,
    createdAt: '2026-05-20T00:00:00Z',
  },
  {
    id: 'cfl_b',
    fileKey: 'xyz',
    nodeId: '',
    url: 'https://www.figma.com/file/xyz/DS',
    fileName: 'Design System',
    frameName: null,
    thumbnailUrl: null,
    thumbnailFetchedAt: null,
    lastSyncedAt: '2026-05-28T00:00:00Z',
    lastSyncError: null,
    createdAt: '2026-05-22T00:00:00Z',
  },
]

describe('taskFigmaRm', () => {
  it('removes when input matches a cuid', async () => {
    mockList.mockResolvedValue({ links })
    mockRm.mockResolvedValue({ ok: true })

    const exit = await taskFigmaRm({
      identifier: 'LUM-42',
      linkIdOrUrl: 'cfl_a',
    })

    expect(exit).toBe(0)
    expect(mockRm).toHaveBeenCalledWith('LUM-42', 'cfl_a')
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Removed Figma link from LUM-42: "Onboarding · Welcome"'
      )
    )
  })

  it('removes when input matches a stored URL', async () => {
    mockList.mockResolvedValue({ links })
    mockRm.mockResolvedValue({ ok: true })

    const exit = await taskFigmaRm({
      identifier: 'LUM-42',
      linkIdOrUrl: 'https://www.figma.com/file/xyz/DS',
    })

    expect(exit).toBe(0)
    expect(mockRm).toHaveBeenCalledWith('LUM-42', 'cfl_b')
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"Design System (file-level)"')
    )
  })

  it('reports "Not linked" and exits 0 when no row matches (idempotent)', async () => {
    mockList.mockResolvedValue({ links })

    const exit = await taskFigmaRm({
      identifier: 'LUM-42',
      linkIdOrUrl: 'cfl_missing',
    })

    expect(exit).toBe(0)
    expect(mockRm).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('Not linked: cfl_missing')
  })
})
