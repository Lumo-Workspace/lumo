/**
 * @jest-environment node
 *
 * LUM-1143 — the shared reviewable-path helper (CodeRabbit
 * `reviews.path_filters`): built-in lockfile / generated exclusions, a
 * repository's include / `!exclude` globs, and the diff filter.
 */
import {
  filterReviewableDiff,
  globToRegExp,
  invalidPathFilter,
  isDefaultExcludedPath,
  isReviewablePath,
  reviewablePathPredicate,
} from '@/ee/security/security-scan/reviewable-path'

describe('globToRegExp', () => {
  it.each([
    ['src/**', 'src/a/b.ts', true],
    ['src/**', 'lib/a.ts', false],
    ['**/dist/**', 'dist/app.js', true],
    ['**/dist/**', 'pkg/dist/app.js', true],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/x/a.ts', false],
    ['*.lock', 'deep/dir/x.lock', true],
    ['a?.md', 'ab.md', true],
    ['./docs/**', 'docs/x.md', true],
    ['file(1).ts', 'file(1).ts', true],
  ])('%s vs %s → %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected)
  })
})

describe('built-in exclusions', () => {
  it.each([
    'package-lock.json',
    'web/yarn.lock',
    'pnpm-lock.yaml',
    'go.sum',
    'Cargo.lock',
    'poetry.lock',
    'public/app.min.js',
    'dist/index.js',
    'packages/a/build/out.js',
    'api/service.pb.go',
    'src/__generated__/schema.ts',
    'vendor/github.com/x/y.go',
  ])('%s is not reviewed by default', p => {
    expect(isDefaultExcludedPath(p)).toBe(true)
    expect(isReviewablePath(p)).toBe(false)
  })

  it.each(['src/index.ts', 'package.json', 'lib/build.ts', 'README.md'])(
    '%s is reviewed by default',
    p => {
      expect(isReviewablePath(p)).toBe(true)
    }
  )
})

describe('repository filters', () => {
  it('`!glob` excludes on top of the defaults', () => {
    const ok = reviewablePathPredicate(['!docs/**'])
    expect(ok('docs/a.md')).toBe(false)
    expect(ok('src/a.ts')).toBe(true)
    expect(ok('yarn.lock')).toBe(false)
  })

  it('includes restrict to matches and can re-admit a default exclusion', () => {
    const ok = reviewablePathPredicate(['src/**', 'package-lock.json'])
    expect(ok('src/a.ts')).toBe(true)
    expect(ok('lib/a.ts')).toBe(false)
    expect(ok('package-lock.json')).toBe(true)
  })

  it('an exclude beats an include', () => {
    const ok = reviewablePathPredicate(['src/**', '!src/legacy/**'])
    expect(ok('src/legacy/a.ts')).toBe(false)
  })

  it('blank / invalid filters are ignored', () => {
    expect(reviewablePathPredicate(['', '  ', '!'])('src/a.ts')).toBe(true)
  })

  it('invalidPathFilter explains a refused filter', () => {
    expect(invalidPathFilter('src/**')).toBeNull()
    expect(invalidPathFilter('!')).toBe('empty glob')
    expect(invalidPathFilter('a'.repeat(201))).toMatch(/longer than/)
    expect(invalidPathFilter('a\nb')).toBe('contains a line break')
  })
})

const section = (path: string) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n+x\n`

describe('filterReviewableDiff', () => {
  it('drops excluded sections and reports both sides', () => {
    const diff = section('src/a.ts') + section('package-lock.json')
    const out = filterReviewableDiff(diff, reviewablePathPredicate())
    expect(out.diff).toBe(section('src/a.ts'))
    expect(out.kept).toEqual(['src/a.ts'])
    expect(out.excluded).toEqual(['package-lock.json'])
  })

  it('reads a deleted file from its --- line', () => {
    const del =
      'diff --git a/yarn.lock b/yarn.lock\ndeleted file mode 100644\n--- a/yarn.lock\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n'
    expect(
      filterReviewableDiff(del, reviewablePathPredicate()).excluded
    ).toEqual(['yarn.lock'])
  })

  it('keeps a section whose path cannot be read', () => {
    const odd = 'diff --git "a/sp ace" "b/sp ace"\n+++ "b/sp ace"\n+x\n'
    expect(filterReviewableDiff(odd, () => false).diff).toBe(odd)
  })
})
