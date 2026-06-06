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
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })
  afterEach(() => logSpy.mockRestore())

  it('lists only worktrees under .worktrees/ and shows the task id', async () => {
    expect(await worktreeList()).toBe(0)
    const printed = logSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(printed).toContain('LUM-267')
    expect(printed).toContain('/repo/.worktrees/LUM-267-scaffold')
    expect(printed).not.toContain('lumo/LUM-261') // the main checkout is excluded
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
