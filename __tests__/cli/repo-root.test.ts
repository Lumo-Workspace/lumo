/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isPathGitTracked, repoRoot } from '@/cli/src/lib/repo-root'

let root: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'repo-root-')))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function file(rel = 'a/b.txt'): string {
  const p = join(root, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, 'x')
  return p
}
const git = (...a: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], {
    cwd: root,
    stdio: 'ignore',
  })

describe('repoRoot', () => {
  it('is the work tree top from a subdirectory', () => {
    git('init', '-q')
    const p = file()
    expect(repoRoot(join(p, '..'))).toBe(root)
  })
  it('is null outside a repo', () => {
    expect(repoRoot(root)).toBeNull()
  })
})

describe('isPathGitTracked', () => {
  it('true for a committed file and its directory', () => {
    const p = file()
    git('init', '-q')
    git('add', '.')
    git('commit', '-qm', 'x', '--no-gpg-sign')
    expect(isPathGitTracked(p)).toBe(true)
    expect(isPathGitTracked(join(root, 'a'))).toBe(true)
  })
  it('false for an untracked file in a repo, and outside any repo', () => {
    const p = file()
    expect(isPathGitTracked(p)).toBe(false)
    execFileSync('git', ['init', '-q'], { cwd: root })
    expect(isPathGitTracked(p)).toBe(false)
  })
  it('fails closed: an unreadable git index counts as tracked', () => {
    const p = file()
    execFileSync('git', ['init', '-q'], { cwd: root })
    writeFileSync(join(root, '.git', 'index'), 'garbage')
    expect(isPathGitTracked(p)).toBe(true)
  })
  it('git not installed counts as untracked', () => {
    const p = file()
    const prev = process.env.PATH
    process.env.PATH = ''
    try {
      expect(isPathGitTracked(p)).toBe(false)
    } finally {
      process.env.PATH = prev
    }
  })
})
