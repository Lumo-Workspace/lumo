import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readGitBranch } from '../../src/lib/git-branch'
import { augmentBodyWithBranch } from '../../src/lib/hook-runner'

function repoWithHead(head: string): string {
  const root = mkdtempSync(join(tmpdir(), 'lumo-branch-'))
  mkdirSync(join(root, '.git'))
  writeFileSync(join(root, '.git', 'HEAD'), head)
  mkdirSync(join(root, 'sub', 'dir'), { recursive: true })
  return root
}

describe('readGitBranch', () => {
  it('reads the branch from a nested cwd', () => {
    const root = repoWithHead('ref: refs/heads/lumo/LUM-12-x\n')
    expect(readGitBranch(join(root, 'sub', 'dir'))).toBe('lumo/LUM-12-x')
  })

  it('follows a worktree .git file', () => {
    const gitdir = mkdtempSync(join(tmpdir(), 'lumo-gitdir-'))
    writeFileSync(join(gitdir, 'HEAD'), 'ref: refs/heads/lumo/LUM-13-y\n')
    const wt = mkdtempSync(join(tmpdir(), 'lumo-wt-'))
    writeFileSync(join(wt, '.git'), `gitdir: ${gitdir}\n`)
    expect(readGitBranch(wt)).toBe('lumo/LUM-13-y')
  })

  it('returns null for a detached HEAD or a non-repo', () => {
    expect(readGitBranch(repoWithHead('3e60d8c94aaaa\n'))).toBeNull()
    expect(
      readGitBranch(mkdtempSync(join(tmpdir(), 'lumo-norepo-')))
    ).toBeNull()
  })

  it('augmentBodyWithBranch adds _lumo_branch from the payload cwd', () => {
    const root = repoWithHead('ref: refs/heads/main\n')
    const out = JSON.parse(augmentBodyWithBranch(JSON.stringify({ cwd: root })))
    expect(out._lumo_branch).toBe('main')
    expect(augmentBodyWithBranch('{}')).toBe('{}')
  })

  it('omits _lumo_branch when the branch name exceeds 255 characters', () => {
    const long = 'a'.repeat(256)
    const root = repoWithHead(`ref: refs/heads/${long}\n`)
    const body = JSON.stringify({ cwd: root })
    expect(augmentBodyWithBranch(body)).toBe(body)
    const ok = repoWithHead(`ref: refs/heads/${'b'.repeat(255)}\n`)
    const out = JSON.parse(augmentBodyWithBranch(JSON.stringify({ cwd: ok })))
    expect(out._lumo_branch).toHaveLength(255)
  })

  it('returns a non-object body unchanged instead of throwing', () => {
    expect(augmentBodyWithBranch('null')).toBe('null')
    expect(augmentBodyWithBranch('[1,2]')).toBe('[1,2]')
    expect(augmentBodyWithBranch('"str"')).toBe('"str"')
  })
})
