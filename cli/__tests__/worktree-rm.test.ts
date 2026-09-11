/**
 * `worktree rm` mechanics: which git commands it runs for a clean / dirty
 * worktree and for `--delete-branch`.
 *
 * LUM-755 folded this command into the confirmation protocol, so the two
 * refusal paths — no `--confirm`, and a dirty worktree without `--force` —
 * are no longer exit 1: they emit a `confirmation_required` envelope on
 * stdout and exit 4 (LUM-761 updated these expectations). The envelope's
 * own contract (fields, `changes` wording, `confirmCommand` composition,
 * TTY rendering) belongs to `__tests__/cli/confirmation-protocol.test.ts`;
 * what this suite adds is that neither gate reaches `git worktree remove`.
 */
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

/**
 * The envelope goes to stdout, so an uncaptured write lands in the jest
 * report; and `confirmCommand` is rebuilt from `process.argv`, which under
 * jest is the test file. Both are pinned here so the refusal paths are
 * asserted rather than printed.
 */
let stdout: string[]
const savedArgv = process.argv
const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

/** The JSON envelope this run wrote to stdout. Fails if there is none. */
function envelope() {
  return JSON.parse(stdout.join('')) as {
    status: string
    command: string
    changes: string[]
    confirmCommand: string
  }
}

const removeCalls = () =>
  runGit.mock.calls
    .map(c => c[0] as string[])
    .filter(args => args[0] === 'worktree' && args[1] === 'remove')

describe('worktreeRm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    stdout = []
    process.argv = ['node', 'lumo', 'worktree', 'rm', 'LUM-267']
    // JSON (the agent path) rather than the TTY text rendering.
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      configurable: true,
      writable: true,
    })
    jest.spyOn(process.stdout, 'write').mockImplementation(s => {
      stdout.push(String(s))
      return true
    })
    isMain.mockReturnValue(true)
    repoRoot.mockReturnValue('/repo')
    runGit.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    // 1st gitOutput call = worktree list; later calls = status --porcelain (clean)
    gitOutput.mockImplementation((args: string[]) =>
      args[0] === 'worktree' ? LIST : ''
    )
  })

  afterEach(() => {
    jest.restoreAllMocks()
    process.argv = savedArgv
    if (originalIsTTY) {
      Object.defineProperty(process.stdout, 'isTTY', originalIsTTY)
    }
  })

  it('without --confirm: exits 4 with the envelope and removes nothing', async () => {
    expect(await worktreeRm('LUM-267', {})).toBe(4)
    expect(envelope()).toMatchObject({
      status: 'confirmation_required',
      command: 'worktree rm',
      confirmCommand: 'lumo worktree rm LUM-267 --confirm',
    })
    expect(removeCalls()).toEqual([])
  })

  it('errors when no worktree matches', async () => {
    expect(await worktreeRm('LUM-999', { confirm: true })).toBe(1)
  })

  it('removes a clean worktree and keeps the branch by default', async () => {
    expect(await worktreeRm('LUM-267', { confirm: true })).toBe(0)
    const calls = runGit.mock.calls.map(c => c[0])
    expect(calls).toContainEqual([
      'worktree',
      'remove',
      '/repo/.worktrees/LUM-267-scaffold',
    ])
    expect(calls).not.toContainEqual(expect.arrayContaining(['branch', '-d']))
  })

  it('accepts --yes as the legacy alias of --confirm', async () => {
    // Kept as an alias by LUM-755 for callers written before it; `--confirm`
    // is what the docs tell an agent to send.
    expect(await worktreeRm('LUM-267', { yes: true })).toBe(0)
    expect(removeCalls()).toEqual([
      ['worktree', 'remove', '/repo/.worktrees/LUM-267-scaffold'],
    ])
  })

  it('a dirty worktree without --force: exits 4 asking for --force, and removes with it', async () => {
    gitOutput.mockImplementation((args: string[]) =>
      args[0] === 'worktree' ? LIST : ' M file.ts'
    )
    // --confirm alone is not enough: discarding uncommitted work is a second
    // gate, so the envelope comes back asking for --force too.
    expect(await worktreeRm('LUM-267', { confirm: true })).toBe(4)
    expect(envelope().confirmCommand).toBe(
      'lumo worktree rm LUM-267 --force --confirm'
    )
    expect(removeCalls()).toEqual([])

    stdout = []
    runGit.mockClear()
    expect(await worktreeRm('LUM-267', { confirm: true, force: true })).toBe(0)
    expect(removeCalls()).toEqual([
      ['worktree', 'remove', '--force', '/repo/.worktrees/LUM-267-scaffold'],
    ])
  })

  it('deletes the branch with --delete-branch', async () => {
    expect(
      await worktreeRm('LUM-267', { confirm: true, deleteBranch: true })
    ).toBe(0)
    expect(runGit.mock.calls.map(c => c[0])).toContainEqual([
      'branch',
      '-d',
      'lumo/LUM-267-scaffold',
    ])
  })
})
