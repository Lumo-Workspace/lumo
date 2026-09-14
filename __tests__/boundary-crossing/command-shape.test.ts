/**
 * LUM-751 — pure shell-command shape helpers: split into segments, unwrap a
 * `bash -c '…'` wrapper, classify a segment as read-only (print / search /
 * git-read / gh-read-or-author / commit / lumo) vs executing.
 */
import {
  splitCommandSegments,
  unwrapShellWrapper,
  isReadOnlySegment,
  executingSegments,
} from '@/lib/boundary-crossing/command-shape'

describe('command-shape (LUM-751)', () => {
  it('splits on shell separators', () => {
    expect(splitCommandSegments('a && b || c; d | e\nf')).toEqual([
      'a ',
      ' b ',
      ' c',
      ' d ',
      ' e',
      'f',
    ])
  })

  it('unwraps bash/sh/zsh -c quoted commands', () => {
    expect(unwrapShellWrapper(`bash -c 'grep -q x file'`)).toBe(
      'grep -q x file'
    )
    expect(unwrapShellWrapper(`sh -c "npm test"`)).toBe('npm test')
    expect(unwrapShellWrapper(`bash -lc "echo hi"`)).toBe('echo hi')
    expect(unwrapShellWrapper('psql -c "select 1"')).toBeNull()
    expect(unwrapShellWrapper('bash script.sh')).toBeNull()
  })

  it('classifies print/search, git read, gh read/authoring, commit and lumo as read-only', () => {
    for (const seg of [
      'echo hello',
      'grep -rn "x" lib/',
      'rg pattern',
      'ast-grep --pattern "$A.$B()"',
      'cat file',
      'git log origin/main..HEAD',
      'git diff main...HEAD',
      'git merge-base origin/main HEAD',
      'git checkout main',
      'git pull origin main',
      'git branch -a',
      'git remote -v',
      'gh pr create --base main --title t',
      'gh pr view 12',
      'git commit -m "x"',
      'lumo crossing explain abc --note "y"',
      'FOO=1 npx rg pattern',
      'sudo cat /etc/hosts',
      'test -z ""',
      '! grep -q x file',
    ]) {
      expect({ seg, ro: isReadOnlySegment(seg) }).toEqual({ seg, ro: true })
    }
    for (const seg of [
      'git push origin main',
      'git merge main',
      'gh pr merge 12',
      'psql -c "x"',
      'node scripts/flush-prod.js',
      'npx prisma migrate deploy',
      'npm install left-pad',
      'git branch -D main',
      'git remote add x y',
    ]) {
      expect({ seg, ro: isReadOnlySegment(seg) }).toEqual({ seg, ro: false })
    }
  })

  it('executingSegments drops read-only segments and recurses into wrappers', () => {
    expect(executingSegments('git log main && git push origin main')).toEqual([
      'git push origin main',
    ])
    expect(executingSegments(`bash -c 'grep -q x f && node run.js'`)).toEqual([
      'node run.js',
    ])
    expect(executingSegments(`bash -c "grep -qiE 'a|b' f"`)).toEqual([])
    expect(executingSegments('echo a; cat b')).toEqual([])
  })
})
