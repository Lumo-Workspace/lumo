import { worktreeRm } from '../src/commands/worktree-rm'
import * as wt from '../src/lib/worktree'

jest.mock('../src/lib/worktree', () => {
  const actual = jest.requireActual('../src/lib/worktree')
  return {
    ...actual,
    isMainCheckout: jest.fn(),
    getRepoRoot: jest.fn(),
    gitOutput: jest.fn(),
    runGit: jest.fn(),
  }
})

const isMain = wt.isMainCheckout as jest.Mock
const repoRoot = wt.getRepoRoot as jest.Mock
const gitOutput = wt.gitOutput as jest.Mock
const runGit = wt.runGit as jest.Mock

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

describe('worktreeRm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    isMain.mockReturnValue(true)
    repoRoot.mockReturnValue('/repo')
    runGit.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    // 1st gitOutput call = worktree list; later calls = status --porcelain (clean)
    gitOutput.mockImplementation((args: string[]) =>
      args[0] === 'worktree' ? LIST : ''
    )
  })

  it('refuses without --yes', async () => {
    expect(await worktreeRm('LUM-267', {})).toBe(1)
    expect(runGit).not.toHaveBeenCalledWith(
      expect.arrayContaining(['worktree', 'remove']),
      expect.anything()
    )
  })

  it('errors when no worktree matches', async () => {
    expect(await worktreeRm('LUM-999', { yes: true })).toBe(1)
  })

  it('removes a clean worktree and keeps the branch by default', async () => {
    expect(await worktreeRm('LUM-267', { yes: true })).toBe(0)
    const calls = runGit.mock.calls.map(c => c[0])
    expect(calls).toContainEqual([
      'worktree',
      'remove',
      '/repo/.worktrees/LUM-267-scaffold',
    ])
    expect(calls).not.toContainEqual(expect.arrayContaining(['branch', '-d']))
  })

  it('refuses a dirty worktree without --force, removes with --force', async () => {
    gitOutput.mockImplementation((args: string[]) =>
      args[0] === 'worktree' ? LIST : ' M file.ts'
    )
    expect(await worktreeRm('LUM-267', { yes: true })).toBe(1)

    jest.clearAllMocks()
    isMain.mockReturnValue(true)
    repoRoot.mockReturnValue('/repo')
    runGit.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    gitOutput.mockImplementation((args: string[]) =>
      args[0] === 'worktree' ? LIST : ' M file.ts'
    )
    expect(await worktreeRm('LUM-267', { yes: true, force: true })).toBe(0)
    expect(runGit.mock.calls.map(c => c[0])).toContainEqual([
      'worktree',
      'remove',
      '--force',
      '/repo/.worktrees/LUM-267-scaffold',
    ])
  })

  it('deletes the branch with --delete-branch', async () => {
    expect(await worktreeRm('LUM-267', { yes: true, deleteBranch: true })).toBe(
      0
    )
    expect(runGit.mock.calls.map(c => c[0])).toContainEqual([
      'branch',
      '-d',
      'lumo/LUM-267-scaffold',
    ])
  })
})
