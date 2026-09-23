import * as fs from 'fs'
import { worktreeList } from '../src/commands/worktree-list'
import * as wt from '../src/lib/worktree'

jest.mock('../src/lib/worktree', () => {
  const actual = jest.requireActual('../src/lib/worktree')
  return { ...actual, getGitCommonDir: jest.fn(), gitOutput: jest.fn() }
})
jest.mock('fs')

const mockFs = fs as jest.Mocked<typeof fs>
const commonDir = wt.getGitCommonDir as jest.Mock
const gitOutput = wt.gitOutput as jest.Mock

const LIST = [
  'worktree /repo',
  'HEAD a',
  'branch refs/heads/lumo/LUM-261',
  '',
  'worktree /repo/.worktrees/LUM-267-scaffold',
  'HEAD b',
  'branch refs/heads/lumo/LUM-267-scaffold',
  '',
].join('\n')

describe('worktreeList', () => {
  let logSpy: jest.SpyInstance
  beforeEach(() => {
    jest.clearAllMocks()
    commonDir.mockReturnValue('/repo/.git')
    gitOutput.mockImplementation((args: string[]) =>
      args[0] === 'worktree' ? LIST : ''
    )
    mockFs.lstatSync.mockReturnValue({ isSymbolicLink: () => true } as never)
    // A Node repo: the main checkout has node_modules (LUM-825).
    mockFs.existsSync.mockReturnValue(true)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })
  afterEach(() => logSpy.mockRestore())

  it('lists only worktrees under .worktrees/ and shows the task id', async () => {
    expect(await worktreeList()).toBe(0)
    const lines = logSpy.mock.calls.map(c => String(c[0]))
    // Verify the TASK-ID COLUMN (first tab-separated field), not just a
    // substring that the branch column (lumo/LUM-267-scaffold) also satisfies.
    const row = lines.find(l => l.includes('/repo/.worktrees/LUM-267-scaffold'))
    expect(row).toBeDefined()
    expect(row!.startsWith('LUM-267\t')).toBe(true)
    expect(lines.join('\n')).not.toContain('lumo/LUM-261') // main checkout excluded
  })

  it('renders dirty + node_modules:MISSING', async () => {
    gitOutput.mockImplementation((args: string[]) => {
      if (args[0] === 'worktree') return LIST
      if (args[0] === 'status') return ' M cli/src/commands/worktree-list.ts'
      return ''
    })
    mockFs.lstatSync.mockReturnValue({
      isSymbolicLink: () => false,
    } as never)
    expect(await worktreeList()).toBe(0)
    const row = logSpy.mock.calls
      .map(c => String(c[0]))
      .find(l => l.includes('/repo/.worktrees/LUM-267-scaffold'))
    expect(row).toBeDefined()
    expect(row).toContain('dirty')
    expect(row).toContain('node_modules:MISSING')
  })

  it('omits the node_modules column in a repo without node_modules', async () => {
    mockFs.existsSync.mockReturnValue(false)
    expect(await worktreeList()).toBe(0)
    const row = logSpy.mock.calls
      .map(c => String(c[0]))
      .find(l => l.includes('/repo/.worktrees/LUM-267-scaffold'))
    expect(row).toBeDefined()
    expect(row).not.toContain('node_modules')
  })

  it('prints an empty notice when none exist', async () => {
    gitOutput.mockImplementation((args: string[]) =>
      args[0] === 'worktree'
        ? 'worktree /repo\nHEAD a\nbranch refs/heads/main\n'
        : ''
    )
    expect(await worktreeList()).toBe(0)
    expect(logSpy.mock.calls.map(c => String(c[0])).join('\n')).toContain(
      'no worktrees'
    )
  })
})
