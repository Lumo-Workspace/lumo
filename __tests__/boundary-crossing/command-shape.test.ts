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

  it('LUM-772: find with -exec / -delete executes, keepGit keeps every git segment', () => {
    expect(isReadOnlySegment('find . -name "*.log"')).toBe(true)
    expect(isReadOnlySegment('find prisma/migrations -name x -delete')).toBe(
      false
    )
    expect(
      isReadOnlySegment('find __tests__ -name "*.test.ts" -exec rm {} +')
    ).toBe(false)
    // Default: git reads / commit are read-only (LUM-751 project-rule idiom).
    expect(isReadOnlySegment('git commit -m "x"')).toBe(true)
    expect(isReadOnlySegment('git log origin/main..HEAD')).toBe(true)
    // keepGit: a git invocation is itself the action under test.
    expect(isReadOnlySegment('git commit -m "x"', { keepGit: true })).toBe(
      false
    )
    expect(
      isReadOnlySegment('git log origin/main..HEAD', { keepGit: true })
    ).toBe(false)
    // …while non-git prose carriers stay dropped either way.
    expect(
      isReadOnlySegment(
        'lumo crossing explain abc --note "git push origin main"',
        { keepGit: true }
      )
    ).toBe(true)
    expect(isReadOnlySegment('echo "git commit -n"', { keepGit: true })).toBe(
      true
    )
    expect(
      executingSegments(
        'lumo task comment LUM-1 "a; b && c" && git commit -m "d" && git push origin feat',
        { keepGit: true }
      )
    ).toEqual(['git commit -m "d"', 'git push origin feat'])
    expect(
      executingSegments(
        'lumo task comment LUM-1 "a; b && c" && git commit -m "d" && git push origin feat'
      )
    ).toEqual(['git push origin feat'])
  })

  it('LUM-772: a heredoc body stays with the segment that opens it', () => {
    // Read-only carrier: dropped whole, its lines never become segments.
    expect(
      executingSegments(
        "cat > probe.ts <<'EOF'\nconst hint = 'npm install left-pad'\nEOF\ngit add probe.ts"
      )
    ).toEqual(['git add probe.ts'])
    // Executing carrier: the body rides along in one segment.
    expect(executingSegments('psql <<EOF\nselect 1\nEOF')).toEqual([
      'psql <<EOF\nselect 1\nEOF',
    ])
    // The owner is the segment holding `<<`, even after a pipe on that line.
    expect(executingSegments('cat <<EOF | node run.js\nx\nEOF')).toEqual([
      'node run.js',
    ])
    expect(executingSegments('node <<EOF | tee log\nx\nEOF')).toEqual([
      'node <<EOF\nx\nEOF',
    ])
    // Text after the terminator is ordinary again.
    expect(
      executingSegments(
        "git commit -F - <<'EOF'\nfix: never push to main\nEOF\ngit push origin feat && echo done"
      )
    ).toEqual(['git push origin feat'])
    expect(
      executingSegments(
        "git commit -F - <<'EOF'\nfix: never push to main\nEOF\ngit push origin feat",
        { keepGit: true }
      )
    ).toEqual([
      "git commit -F - <<'EOF'\nfix: never push to main\nEOF",
      'git push origin feat',
    ])
    // Unterminated: nothing is swallowed — plain line splitting.
    expect(
      executingSegments('git commit -F - <<EOF\nline one\ngit push origin feat')
    ).toEqual(['line one', 'git push origin feat'])
    // A quoted `<<` is not a heredoc.
    expect(executingSegments('echo "<<EOF" && node x.js')).toEqual([
      'node x.js',
    ])
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
