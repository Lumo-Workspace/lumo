/**
 * LUM-755 confirmation protocol: `worktree rm` has two gates — a missing
 * --confirm and a dirty worktree without --force — and both stop with the
 * same `confirmation_required` envelope on stdout and exit 4, sending no
 * `git worktree remove`. --yes survives only as a legacy alias of --confirm,
 * so it satisfies the first gate but never the second.
 */
import { worktreeRm } from '../src/commands/worktree-rm'
import { EXIT_CONFIRMATION_REQUIRED } from '../src/lib/confirmation'
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

/** After `git worktree remove` ran, git lists only the main checkout. */
const MAIN_ONLY = LIST.split('\n\n')[0]!

/**
 * gitOutput fake: `worktree list` answers LIST until a `worktree remove` was
 * sent (then the target is unregistered, LUM-971); anything else is
 * `status --porcelain` and answers `status`.
 */
function gitFake(status: string) {
  return (args: string[]) => {
    if (args[0] !== 'worktree') return status
    const removed = runGit.mock.calls.some(
      c => c[0][0] === 'worktree' && c[0][1] === 'remove'
    )
    return removed ? MAIN_ONLY : LIST
  }
}

/** The envelope `emitConfirmation` wrote to stdout, parsed and shape-checked. */
function envelope(out: string[]) {
  const parsed = JSON.parse(out.join('')) as {
    status: string
    command: string
    changes: string[]
    confirmCommand: string
  }
  expect(parsed.status).toBe('confirmation_required')
  expect(parsed.command).toBe('worktree rm')
  return parsed
}

describe('worktreeRm', () => {
  let stdout: string[]
  const savedArgv = process.argv
  const savedIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

  beforeEach(() => {
    jest.clearAllMocks()
    stdout = []
    // JSON rendering (the agent path) rather than the TTY text form.
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      configurable: true,
      writable: true,
    })
    jest.spyOn(process.stdout, 'write').mockImplementation(s => {
      stdout.push(String(s))
      return true
    })
    process.argv = ['node', 'lumo', 'worktree', 'rm', 'LUM-267']
    isMain.mockReturnValue(true)
    repoRoot.mockReturnValue('/repo')
    runGit.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    // worktree list → LIST (until removed); status --porcelain → clean
    gitOutput.mockImplementation(gitFake(''))
  })

  afterEach(() => {
    jest.restoreAllMocks()
    process.argv = savedArgv
    if (savedIsTTY) {
      Object.defineProperty(process.stdout, 'isTTY', savedIsTTY)
    }
  })

  it('refuses without --confirm and prints the envelope', async () => {
    expect(await worktreeRm('LUM-267', {})).toBe(EXIT_CONFIRMATION_REQUIRED)
    const env = envelope(stdout)
    expect(env.changes[0]).toContain('/repo/.worktrees/LUM-267-scaffold')
    expect(env.changes.join('\n')).toContain('lumo/LUM-267-scaffold')
    expect(env.confirmCommand).toBe('lumo worktree rm LUM-267 --confirm')
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
    gitOutput.mockImplementation(gitFake(' M file.ts'))
    // --yes clears the confirm gate; the dirty tree is a second gate, so the
    // envelope comes back with --force folded into confirmCommand.
    expect(await worktreeRm('LUM-267', { yes: true })).toBe(
      EXIT_CONFIRMATION_REQUIRED
    )
    const env = envelope(stdout)
    expect(env.changes.join('\n')).toContain('uncommitted changes')
    expect(env.confirmCommand).toBe(
      'lumo worktree rm LUM-267 --force --confirm'
    )
    expect(runGit).not.toHaveBeenCalledWith(
      expect.arrayContaining(['worktree', 'remove']),
      expect.anything()
    )

    jest.clearAllMocks()
    isMain.mockReturnValue(true)
    repoRoot.mockReturnValue('/repo')
    runGit.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    gitOutput.mockImplementation(gitFake(' M file.ts'))
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
