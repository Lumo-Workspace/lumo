/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/figma-api', () => ({
  listFigmaLinks: jest.fn(),
  refreshFigmaLinks: jest.fn(),
}))

import { listFigmaLinks, refreshFigmaLinks } from '@/cli/src/lib/figma-api'
import { taskFigmaRefresh } from '@/cli/src/commands/task-figma-refresh'

const mockList = listFigmaLinks as jest.Mock
const mockRefresh = refreshFigmaLinks as jest.Mock

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

describe('taskFigmaRefresh', () => {
  it('reports "no Figma links attached" when results are empty', async () => {
    mockList.mockResolvedValue({ links: [] })
    mockRefresh.mockResolvedValue({ results: [] })
    const exit = await taskFigmaRefresh({ identifier: 'LUM-42' })
    expect(exit).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('No Figma links on LUM-42')
    )
  })

  it('renders per-link ✓/✗ markers with labels from list lookup', async () => {
    mockList.mockResolvedValue({
      links: [
        {
          id: 'cfl_a',
          fileKey: 'abc',
          nodeId: '1:2',
          url: 'u1',
          fileName: 'Onboarding',
          frameName: 'Welcome',
          thumbnailUrl: null,
          thumbnailFetchedAt: null,
          lastSyncedAt: '2026-05-28',
          lastSyncError: null,
          createdAt: '2026-05-20',
        },
        {
          id: 'cfl_b',
          fileKey: 'xyz',
          nodeId: '',
          url: 'u2',
          fileName: 'Design System',
          frameName: null,
          thumbnailUrl: null,
          thumbnailFetchedAt: null,
          lastSyncedAt: '2026-05-28',
          lastSyncError: null,
          createdAt: '2026-05-22',
        },
      ],
    })
    mockRefresh.mockResolvedValue({
      results: [
        { id: 'cfl_a', ok: true },
        { id: 'cfl_b', ok: false, error: 'file not accessible' },
      ],
    })

    const exit = await taskFigmaRefresh({ identifier: 'LUM-42' })
    expect(exit).toBe(0)
    const output = logSpy.mock.calls.map(c => c[0]).join('\n')
    expect(output).toContain('Refreshed 2 Figma links on LUM-42')
    expect(output).toContain('✓ Onboarding · Welcome')
    expect(output).toContain('✗ Design System (file-level)')
    expect(output).toContain('file not accessible')
  })

  it('prints a reconnect hint and exits 1 on figma_not_connected', async () => {
    mockList.mockRejectedValue(
      Object.assign(new Error('Figma not connected'), {
        code: 'figma_not_connected',
      })
    )
    const exit = await taskFigmaRefresh({ identifier: 'LUM-42' })
    expect(exit).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Figma is not connected')
    )
  })

  it('prints a reconnect hint and exits 1 on figma_needs_reauth', async () => {
    mockList.mockResolvedValue({ links: [] })
    mockRefresh.mockRejectedValue(
      Object.assign(new Error('Figma needs reauth'), {
        code: 'figma_needs_reauth',
      })
    )
    const exit = await taskFigmaRefresh({ identifier: 'LUM-42' })
    expect(exit).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Figma is not connected')
    )
  })
})
