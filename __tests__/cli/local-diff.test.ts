/**
 * @jest-environment node
 */
/**
 * LUM-1255 — which added lines a local scan reads, per scope, on a real git
 * checkout (mocks would only prove what the mock says).
 */
import * as fs from 'fs'
import * as path from 'path'
import {
  collectLocalDiff,
  fileAsAdded,
  isBinaryContent,
  UNTRACKED_MAX_BYTES,
} from '../../cli/src/lib/local-diff'
import {
  git,
  isolateGitEnv,
  makeSandbox,
  type Sandbox,
} from '../../cli/test-support/real-git'

function paths(d: ReturnType<typeof collectLocalDiff>): string[] {
  return d.files.map(f => f.path).sort()
}

describe('fileAsAdded', () => {
  it('numbers lines from 1 and drops the final newline and CRs', () => {
    expect(fileAsAdded('a.ts', 'one\r\ntwo\n')).toEqual({
      path: 'a.ts',
      lines: [
        { lineNo: 1, text: 'one' },
        { lineNo: 2, text: 'two' },
      ],
    })
  })

  it('an empty file has no lines', () => {
    expect(fileAsAdded('a.ts', '')).toEqual({ path: 'a.ts', lines: [] })
  })
})

describe('isBinaryContent', () => {
  it('is true only when a NUL byte appears early', () => {
    expect(isBinaryContent(Buffer.from('plain text'))).toBe(false)
    expect(isBinaryContent(Buffer.from([0x50, 0x00, 0x4b]))).toBe(true)
  })
})

describe('collectLocalDiff (real git)', () => {
  let restore: () => void
  let sb: Sandbox
  const write = (rel: string, body: string | Buffer) => {
    fs.mkdirSync(path.dirname(path.join(sb.main, rel)), { recursive: true })
    fs.writeFileSync(path.join(sb.main, rel), body)
  }

  beforeAll(() => {
    restore = isolateGitEnv()
  })
  afterAll(() => restore())

  beforeEach(() => {
    sb = makeSandbox('main')
    git(sb.main, 'checkout', '-q', '-b', 'feature')
    write('committed.ts', 'export const a = 1\n')
    git(sb.main, 'add', '-A')
    git(sb.main, 'commit', '-q', '-m', 'feature commit')
    write('staged.ts', 'export const s = 1\n')
    git(sb.main, 'add', 'staged.ts')
    write('README.md', 'hello\nedited line\n')
    write('untracked.ts', 'export const u = 1\n')
  })
  afterEach(() => sb.cleanup())

  it('default: merge-base → working tree, committed + staged + unstaged + untracked', () => {
    const d = collectLocalDiff({ kind: 'default' }, sb.main)
    expect(paths(d)).toEqual([
      'README.md',
      'committed.ts',
      'staged.ts',
      'untracked.ts',
    ])
    expect(d.description).toMatch(
      /^origin\/main \(merge-base [0-9a-f]+\) → working tree$/
    )
    const readme = d.files.find(f => f.path === 'README.md')
    expect(readme?.lines).toEqual([{ lineNo: 2, text: 'edited line' }])
  })

  it('--staged: only the index, never the working tree or untracked files', () => {
    const d = collectLocalDiff({ kind: 'staged' }, sb.main)
    expect(paths(d)).toEqual(['staged.ts'])
    expect(d.description).toBe('staged changes')
  })

  it('--since <ref>: from that ref, not the merge-base', () => {
    const d = collectLocalDiff({ kind: 'since', ref: 'HEAD' }, sb.main)
    expect(paths(d)).toEqual(['README.md', 'staged.ts', 'untracked.ts'])
    expect(d.description).toBe('HEAD → working tree')
  })

  it('an unknown --since ref is an actionable error', () => {
    expect(() =>
      collectLocalDiff({ kind: 'since', ref: 'no-such-ref' }, sb.main)
    ).toThrow(/Unknown ref "no-such-ref"/)
  })

  it('no default branch → asks for --since or --staged', () => {
    git(sb.main, 'remote', 'remove', 'origin')
    expect(() => collectLocalDiff({ kind: 'default' }, sb.main)).toThrow(
      /--since <ref> or --staged/
    )
  })

  it('skips untracked binary and oversized files, and reports them', () => {
    write('image.bin', Buffer.from([0x89, 0x50, 0x00, 0x47]))
    write('huge.txt', 'x'.repeat(UNTRACKED_MAX_BYTES + 1))
    const d = collectLocalDiff({ kind: 'default' }, sb.main)
    expect(d.skipped.sort()).toEqual(['huge.txt', 'image.bin'])
    expect(paths(d)).not.toContain('image.bin')
  })

  it('ignores user diff config that would change the b/ prefix', () => {
    git(sb.main, 'config', 'diff.noprefix', 'true')
    git(sb.main, 'config', 'diff.mnemonicPrefix', 'true')
    const d = collectLocalDiff({ kind: 'staged' }, sb.main)
    expect(paths(d)).toEqual(['staged.ts'])
  })

  it('reads a diff larger than the 1 MiB spawnSync default', () => {
    const big = Array.from(
      { length: 40_000 },
      (_, i) => `export const value${i} = "${'x'.repeat(40)}"`
    ).join('\n')
    write('big.ts', `${big}\n`)
    git(sb.main, 'add', 'big.ts')
    const d = collectLocalDiff({ kind: 'staged' }, sb.main)
    const bigFile = d.files.find(f => f.path === 'big.ts')
    expect(bigFile?.lines).toHaveLength(40_000)
  })

  it('skips an unreadable untracked file instead of aborting', () => {
    write('locked.ts', 'export const l = 1\n')
    fs.chmodSync(path.join(sb.main, 'locked.ts'), 0o000)
    try {
      const d = collectLocalDiff({ kind: 'default' }, sb.main)
      expect(d.skipped).toContain('locked.ts')
      expect(paths(d)).toContain('untracked.ts')
    } finally {
      fs.chmodSync(path.join(sb.main, 'locked.ts'), 0o644)
    }
  })

  it('--since a ref that is also a path name diffs the ref', () => {
    git(sb.main, 'branch', 'release')
    write('release/notes.md', 'notes\n')
    const d = collectLocalDiff({ kind: 'since', ref: 'release' }, sb.main)
    expect(paths(d)).toEqual(
      expect.arrayContaining(['README.md', 'staged.ts', 'release/notes.md'])
    )
  })

  it('paths are repo-relative when run from a subdirectory', () => {
    write('sub/inner.ts', 'export const i = 1\n')
    const d = collectLocalDiff({ kind: 'default' }, path.join(sb.main, 'sub'))
    expect(paths(d)).toContain('sub/inner.ts')
  })
})
