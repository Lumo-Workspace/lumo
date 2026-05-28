/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/figma-api', () => ({
  addFigmaLink: jest.fn(),
}))

import { addFigmaLink } from '@/cli/src/lib/figma-api'
import { taskFigmaAdd } from '@/cli/src/commands/task-figma-add'

const mockAdd = addFigmaLink as jest.Mock

let logSpy: jest.SpyInstance
let errSpy: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
  errSpy.mockRestore()
})

describe('taskFigmaAdd', () => {
  const baseLink = {
    id: 'cfl_1',
    fileKey: 'abc',
    nodeId: '1:2',
    url: 'https://www.figma.com/file/abc/F?node-id=1-2',
    fileName: 'My File',
    frameName: 'Welcome',
    thumbnailUrl: null,
    thumbnailFetchedAt: null,
    lastSyncedAt: '2026-05-28T00:00:00Z',
    lastSyncError: null,
    createdAt: '2026-05-28T00:00:00Z',
  }

  it('prints "fileName · frameName" for a node-level link', async () => {
    mockAdd.mockResolvedValue({ link: baseLink })
    const exit = await taskFigmaAdd({ identifier: 'LUM-42', url: baseLink.url })
    expect(exit).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Linked LUM-42 ↔ Figma "My File · Welcome"')
    )
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(baseLink.url))
  })

  it('prints "(file-level)" decoration when nodeId is the empty sentinel', async () => {
    mockAdd.mockResolvedValue({
      link: { ...baseLink, nodeId: '', frameName: null },
    })
    const exit = await taskFigmaAdd({ identifier: 'LUM-42', url: baseLink.url })
    expect(exit).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Linked LUM-42 ↔ Figma "My File (file-level)"')
    )
  })

  it('renders a friendly hint and exits 1 on figma_not_connected', async () => {
    mockAdd.mockRejectedValue(
      Object.assign(new Error('Figma not connected'), {
        code: 'figma_not_connected',
      })
    )
    const exit = await taskFigmaAdd({ identifier: 'LUM-42', url: baseLink.url })
    expect(exit).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("haven't connected Figma yet")
    )
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('/settings/integrations')
    )
  })

  it('renders a friendly hint and exits 1 on figma_needs_reauth', async () => {
    mockAdd.mockRejectedValue(
      Object.assign(new Error('Figma needs reauth'), {
        code: 'figma_needs_reauth',
      })
    )
    const exit = await taskFigmaAdd({ identifier: 'LUM-42', url: baseLink.url })
    expect(exit).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Figma token is no longer valid')
    )
  })

  it('rethrows unknown errors so the CLI wrapper can handle them', async () => {
    const err = Object.assign(new Error('boom'), { status: 500 })
    mockAdd.mockRejectedValue(err)
    await expect(
      taskFigmaAdd({ identifier: 'LUM-42', url: baseLink.url })
    ).rejects.toBe(err)
  })
})
