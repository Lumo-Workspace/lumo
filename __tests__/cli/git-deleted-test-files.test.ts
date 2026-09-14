/**
 * @jest-environment node
 *
 * LUM-779 — the CLI's local-git probe behind the TEST_FILE_DELETED net-deletion
 * verdict. Real temporary repositories, no mocks: the question is what git
 * says, so the test asks git.
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  collectDeletedTestFiles,
  looksLikeDeleteCommand,
} from '@/cli/src/lib/git-deleted-test-files'

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  ).trim()

const dirs: string[] = []
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lum779-'))
  dirs.push(dir)
  git(dir, 'init', '-q', '-b', 'main')
  mkdirSync(join(dir, '__tests__'), { recursive: true })
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, '__tests__', 'a.test.ts'), 'a')
  writeFileSync(join(dir, 'lib', 'b.spec.ts'), 'b')
  writeFileSync(join(dir, 'lib', 'code.ts'), 'code')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe('collectDeletedTestFiles (LUM-779)', () => {
  it('returns null outside a git repository — the probe could not answer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lum779-nogit-'))
    dirs.push(dir)
    expect(collectDeletedTestFiles(dir)).toBeNull()
  })

  it('returns [] when no tracked test file is missing', () => {
    expect(collectDeletedTestFiles(repo())).toEqual([])
  })

  it('lists a tracked test file removed from the working tree (plain rm)', () => {
    const dir = repo()
    unlinkSync(join(dir, '__tests__', 'a.test.ts'))
    expect(collectDeletedTestFiles(dir)).toEqual(['__tests__/a.test.ts'])
  })

  it('lists a tracked test file staged for deletion (git rm)', () => {
    const dir = repo()
    git(dir, 'rm', '-q', 'lib/b.spec.ts')
    expect(collectDeletedTestFiles(dir)).toEqual(['lib/b.spec.ts'])
  })

  it('ignores an untracked scratch test file that was created and then removed', () => {
    const dir = repo()
    writeFileSync(join(dir, '__tests__', 'zz-probe.test.ts'), 'probe')
    unlinkSync(join(dir, '__tests__', 'zz-probe.test.ts'))
    expect(collectDeletedTestFiles(dir)).toEqual([])
  })

  it('ignores a tracked NON-test file that was removed', () => {
    const dir = repo()
    unlinkSync(join(dir, 'lib', 'code.ts'))
    expect(collectDeletedTestFiles(dir)).toEqual([])
  })

  it('reports nothing after a restore round trip (rm, then checkout from HEAD)', () => {
    const dir = repo()
    unlinkSync(join(dir, '__tests__', 'a.test.ts'))
    git(dir, 'checkout', '--', '__tests__/a.test.ts')
    expect(collectDeletedTestFiles(dir)).toEqual([])
  })

  it('lists a test file whose deletion was already committed on top of the base branch', () => {
    const dir = repo()
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    git(dir, 'rm', '-q', '__tests__/a.test.ts')
    git(dir, 'commit', '-q', '-m', 'drop test')
    expect(collectDeletedTestFiles(dir)).toEqual(['__tests__/a.test.ts'])
  })

  it('does not report a deletion that is already on the base branch itself', () => {
    const dir = repo()
    git(dir, 'rm', '-q', '__tests__/a.test.ts')
    git(dir, 'commit', '-q', '-m', 'drop test on main')
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    expect(collectDeletedTestFiles(dir)).toEqual([])
  })

  it('merges working-tree and committed deletions, sorted and de-duplicated', () => {
    const dir = repo()
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    git(dir, 'rm', '-q', 'lib/b.spec.ts')
    git(dir, 'commit', '-q', '-m', 'drop spec')
    unlinkSync(join(dir, '__tests__', 'a.test.ts'))
    expect(collectDeletedTestFiles(dir)).toEqual([
      '__tests__/a.test.ts',
      'lib/b.spec.ts',
    ])
  })
})

describe('looksLikeDeleteCommand (LUM-779)', () => {
  it.each([
    'rm __tests__/a.test.ts',
    'git rm lib/b.spec.ts',
    'ls; rm -rf __tests__/fixtures',
    'bash -c "rm -f /tmp/x.test.ts"',
    'git   rm -r __tests__',
  ])('is true for a command carrying rm / git rm: %s', cmd => {
    expect(looksLikeDeleteCommand(cmd)).toBe(true)
  })

  it.each([
    'npx jest __tests__/a.test.ts',
    'rmdir empty',
    'npm run format',
    'git status --porcelain',
  ])('is false when no rm token is present: %s', cmd => {
    expect(looksLikeDeleteCommand(cmd)).toBe(false)
  })
})
