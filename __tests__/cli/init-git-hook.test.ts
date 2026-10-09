/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { installGitHook } from '@/cli/src/commands/init'
import { LUMO_HOOK_BEGIN } from '@/cli/src/lib/git-hook-template'

let stdoutSpy: jest.SpyInstance

beforeEach(() => {
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => {
  stdoutSpy.mockRestore()
})

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'lumo-setup-hook-'))
}

describe('installGitHook', () => {
  it('writes the prepare-commit-msg hook in a plain git repo', () => {
    const dir = tmp()
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      installGitHook(dir)
      const hookPath = join(dir, '.git', 'hooks', 'prepare-commit-msg')
      expect(existsSync(hookPath)).toBe(true)
      expect(readFileSync(hookPath, 'utf8')).toContain(LUMO_HOOK_BEGIN)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is idempotent (second run does not throw)', () => {
    const dir = tmp()
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      installGitHook(dir)
      expect(() => installGitHook(dir)).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('degrades (writes nothing) when core.hooksPath is set', () => {
    const dir = tmp()
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      execFileSync('git', ['config', 'core.hooksPath', '.husky/_'], {
        cwd: dir,
      })
      installGitHook(dir)
      const hookPath = join(dir, '.git', 'hooks', 'prepare-commit-msg')
      expect(existsSync(hookPath)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does nothing (no throw) outside a git repo', () => {
    const dir = tmp()
    try {
      expect(() => installGitHook(dir)).not.toThrow()
      const hookPath = join(dir, '.git', 'hooks', 'prepare-commit-msg')
      expect(existsSync(hookPath)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
