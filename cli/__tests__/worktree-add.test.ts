import * as fs from 'fs'
import { worktreeAdd } from '../src/commands/worktree-add'
import * as wt from '../src/lib/worktree'

jest.mock('../src/lib/worktree', () => {
  const actual = jest.requireActual('../src/lib/worktree')
  return {
    ...actual,
    isMainCheckout: jest.fn(),
    getRepoRoot: jest.fn(),
    runGit: jest.fn(),
  }
})
jest.mock('fs')

const mockFs = fs as jest.Mocked<typeof fs>
const isMain = wt.isMainCheckout as jest.Mock
const repoRoot = wt.getRepoRoot as jest.Mock
const runGit = wt.runGit as jest.Mock

describe('worktreeAdd', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    isMain.mockReturnValue(true)
    repoRoot.mockReturnValue('/repo')
    runGit.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    mockFs.existsSync.mockImplementation((p: fs.PathLike) =>
      String(p).endsWith('node_modules')
    )
    mockFs.mkdirSync.mockReturnValue(undefined as never)
    mockFs.symlinkSync.mockReturnValue(undefined as never)
  })

  it('rejects an unparseable id', async () => {
    expect(await worktreeAdd('garbage', undefined, {})).toBe(1)
    expect(runGit).not.toHaveBeenCalled()
  })

  it('refuses when not on the main checkout', async () => {
    isMain.mockReturnValue(false)
    expect(await worktreeAdd('LUM-267', undefined, {})).toBe(1)
  })

  it('errors when the target dir already exists', async () => {
    mockFs.existsSync.mockReturnValue(true) // dir + node_modules both "exist"
    expect(await worktreeAdd('LUM-267', 'scaffold', {})).toBe(1)
  })

  it('creates the worktree off origin/main and symlinks node_modules', async () => {
    // rev-parse --verify (branch missing) → status 1; everything else → 0
    runGit.mockImplementation((args: string[]) =>
      args[0] === 'rev-parse'
        ? { status: 1, stdout: '', stderr: '' }
        : { status: 0, stdout: '', stderr: '' }
    )
    expect(await worktreeAdd('LUM-267', 'scaffold', {})).toBe(0)

    const calls = runGit.mock.calls.map(c => c[0])
    expect(calls).toContainEqual(['fetch', 'origin', 'main'])
    expect(calls).toContainEqual([
      'worktree',
      'add',
      '/repo/.worktrees/LUM-267-scaffold',
      '-b',
      'lumo/LUM-267-scaffold',
      'origin/main',
    ])
    expect(mockFs.symlinkSync).toHaveBeenCalledWith(
      '/repo/node_modules',
      '/repo/.worktrees/LUM-267-scaffold/node_modules'
    )
  })

  it('continues without symlinking when main has no node_modules', async () => {
    // Nothing exists: target dir absent (no early-error) AND no node_modules src.
    mockFs.existsSync.mockReturnValue(false)
    runGit.mockImplementation((args: string[]) =>
      args[0] === 'rev-parse'
        ? { status: 1, stdout: '', stderr: '' }
        : { status: 0, stdout: '', stderr: '' }
    )
    expect(await worktreeAdd('LUM-267', 'scaffold', {})).toBe(0)
    expect(mockFs.symlinkSync).not.toHaveBeenCalled()
  })

  it('provisions husky hooks shim into the worktree', async () => {
    // Both node_modules and the husky shim exist in the main checkout.
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const s = String(p)
      return s.endsWith('node_modules') || s.endsWith('.husky/_')
    })
    runGit.mockImplementation((args: string[]) =>
      args[0] === 'rev-parse'
        ? { status: 1, stdout: '', stderr: '' }
        : { status: 0, stdout: '', stderr: '' }
    )
    expect(await worktreeAdd('LUM-267', 'scaffold', {})).toBe(0)
    expect(mockFs.cpSync).toHaveBeenCalledWith(
      '/repo/.husky/_',
      '/repo/.worktrees/LUM-267-scaffold/.husky/_',
      { recursive: true }
    )
  })

  it('warns when main checkout has no husky shim instead of silently skipping', async () => {
    // node_modules present, but the husky shim was never generated in main.
    mockFs.existsSync.mockImplementation((p: fs.PathLike) =>
      String(p).endsWith('node_modules')
    )
    runGit.mockImplementation((args: string[]) =>
      args[0] === 'rev-parse'
        ? { status: 1, stdout: '', stderr: '' }
        : { status: 0, stdout: '', stderr: '' }
    )
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    expect(await worktreeAdd('LUM-267', 'scaffold', {})).toBe(0)
    expect(mockFs.cpSync).not.toHaveBeenCalled()
    const out = logSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(out).toMatch(/husky/i)
    logSpy.mockRestore()
  })

  it('reuses an existing branch (no -b) and skips fetch with --no-fetch', async () => {
    runGit.mockReturnValue({ status: 0, stdout: '', stderr: '' }) // rev-parse → 0 = branch exists
    expect(await worktreeAdd('LUM-267', undefined, { noFetch: true })).toBe(0)

    const calls = runGit.mock.calls.map(c => c[0])
    expect(calls).not.toContainEqual(['fetch', 'origin', 'main'])
    expect(calls).toContainEqual([
      'worktree',
      'add',
      '/repo/.worktrees/LUM-267',
      'lumo/LUM-267',
    ])
  })
})
