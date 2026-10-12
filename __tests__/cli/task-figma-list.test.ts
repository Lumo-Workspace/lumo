/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/figma-api', () => ({
  listFigmaLinks: jest.fn(),
}))

import { listFigmaLinks } from '@/cli/src/lib/figma-api'
import { taskFigmaList } from '@/cli/src/commands/task-figma-list'

const mockList = listFigmaLinks as jest.Mock

let logSpy: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => logSpy.mockRestore())

function row(
  o: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    id: 'cfl_xxx1',
    fileKey: 'abc',
    nodeId: '1:2',
    url: 'https://www.figma.com/file/abc/F?node-id=1-2',
    fileName: 'Onboarding',
    frameName: 'Welcome',
    thumbnailUrl: 'https://thumb.example/a.png',
    thumbnailFetchedAt: new Date().toISOString(),
    lastSyncedAt: '2026-05-28T12:00:00Z',
    lastSyncError: null,
    createdAt: '2026-05-20T00:00:00Z',
    ...o,
  }
}

describe('taskFigmaList', () => {
  it('prints a placeholder when no links exist', async () => {
    mockList.mockResolvedValue({ links: [] })
    const exit = await taskFigmaList({ identifier: 'LUM-42' })
    expect(exit).toBe(0)
    expect(logSpy).toHaveBeenCalledWith('No Figma links on LUM-42.')
  })

  it('renders each link as a fixed-width row with frame name', async () => {
    mockList.mockResolvedValue({ links: [row()] })
    await taskFigmaList({ identifier: 'LUM-42' })
    const output = logSpy.mock.calls.map(c => c[0]).join('\n')
    expect(output).toContain('cfl_xxx1')
    expect(output).toContain('Onboarding')
    expect(output).toContain('Welcome')
    expect(output).toContain('2026-05-28')
  })

  it('shows "(file-level)" when frameName is null', async () => {
    mockList.mockResolvedValue({
      links: [row({ frameName: null, nodeId: '' })],
    })
    await taskFigmaList({ identifier: 'LUM-42' })
    const output = logSpy.mock.calls.map(c => c[0]).join('\n')
    expect(output).toContain('(file-level)')
  })

  it('flags ⚠ thumbnail stale when fetchedAt > 25 days', async () => {
    const stale = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
    mockList.mockResolvedValue({
      links: [row({ thumbnailFetchedAt: stale })],
    })
    await taskFigmaList({ identifier: 'LUM-42' })
    const output = logSpy.mock.calls.map(c => c[0]).join('\n')
    expect(output).toContain('⚠ thumbnail stale')
  })

  it('does NOT flag stale when there is no thumbnail at all', async () => {
    mockList.mockResolvedValue({
      links: [row({ thumbnailUrl: null, thumbnailFetchedAt: null })],
    })
    await taskFigmaList({ identifier: 'LUM-42' })
    const output = logSpy.mock.calls.map(c => c[0]).join('\n')
    expect(output).not.toContain('⚠ thumbnail stale')
  })
})
