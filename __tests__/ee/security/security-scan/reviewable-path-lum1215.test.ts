/**
 * @jest-environment node
 *
 * LUM-1215 — the built-in exclusions skip real build output and vendored
 * dependencies only: an ordinary source / test file in a directory that
 * happens to be named dist, build or vendor is reviewed. And which paths
 * were skipped, by the defaults or by the repository's own filters, is
 * recorded so the summary can say so.
 */
import {
  isBuildOutputPath,
  isDefaultExcludedPath,
  isReviewablePath,
  parseReviewPathSkips,
  pathFilterSkips,
  REVIEW_PATH_SKIPS_MAX_PATHS,
} from '@/ee/security/security-scan/reviewable-path'

describe('isBuildOutputPath / built-in default (LUM-1215)', () => {
  it.each([
    // The benchmark miss (keycloak 36882).
    'quarkus/tests/integration/src/test/java/org/keycloak/it/cli/dist/UpdateCommandDistTest.java',
    'src/main/java/com/acme/build/Builder.java',
    'src/main/java/com/acme/build/Foo.java',
    'internal/build/compile.go',
    'pkg/vendor/client.go',
    'cmd/build/main.go',
    'src/dist/format.ts',
    'tests/dist/packaging_test.py',
    'test/build/fixture.spec.ts',
    'services/api/__tests__/build/x.test.ts',
    'Source/Build/Builder.cs',
    // A file NAMED like an output directory is not inside one.
    'scripts/build',
    'build.gradle',
    'dist.config.js',
    'lib/build.ts',
  ])('%s is reviewed by default', p => {
    expect(isBuildOutputPath(p)).toBe(false)
    expect(isDefaultExcludedPath(p)).toBe(false)
    expect(isReviewablePath(p)).toBe(true)
  })

  it.each([
    // Root and package-root build output.
    'dist/bundle.js',
    'dist/src/index.js',
    'build/index.html',
    'build/lib/pkg/module.py',
    'packages/ui/dist/index.js',
    'packages/ui/build/main.css',
    'app/build/outputs/apk/debug/app.apk',
    'android/app/build/generated/R.java',
    'web/dist/assets/app.js',
    // Go modules' vendored dependencies (root or a nested module).
    'vendor/github.com/x/y.go',
    'tools/vendor/golang.org/x/mod/module.go',
    // Always build output / dependencies, at any depth.
    'node_modules/left-pad/index.js',
    'src/node_modules/x/index.js',
    '.next/server/app.js',
    'apps/web/.next/static/chunk.js',
    'coverage/lcov-report/index.html',
    'src/coverage/x.json',
    'src/__generated__/schema.ts',
  ])('%s stays excluded by default', p => {
    expect(isDefaultExcludedPath(p)).toBe(true)
    expect(isReviewablePath(p)).toBe(false)
  })

  it('an output directory above the source tree still excludes it', () => {
    expect(isBuildOutputPath('dist/src/index.js')).toBe(true)
    expect(isBuildOutputPath('build/test/x.js')).toBe(true)
  })

  it('only directories named exactly dist / build / vendor count', () => {
    expect(isBuildOutputPath('distribution/x.js')).toBe(false)
    expect(isBuildOutputPath('builds/x.js')).toBe(false)
    expect(isBuildOutputPath('buildSrc/src/main/kotlin/x.kt')).toBe(false)
  })
})

describe('pathFilterSkips (LUM-1215)', () => {
  const paths = [
    'src/main/java/com/acme/build/Foo.java',
    'dist/bundle.js',
    'package-lock.json',
    'docs/a.md',
    'src/a.ts',
  ]

  it('no repository filters: the skipped files are the built-in ones', () => {
    expect(pathFilterSkips(paths)).toEqual({
      builtIn: { count: 2, paths: ['dist/bundle.js', 'package-lock.json'] },
      configured: { count: 0 },
    })
  })

  it('a repository `!glob` is counted as configured, not built-in', () => {
    expect(pathFilterSkips(paths, ['!docs/**'])).toEqual({
      builtIn: { count: 2, paths: ['dist/bundle.js', 'package-lock.json'] },
      configured: { count: 1 },
    })
  })

  it('an exclude that also matches a built-in default is configured', () => {
    expect(pathFilterSkips(['dist/a.js'], ['!dist/**'])).toEqual({
      builtIn: { count: 0, paths: [] },
      configured: { count: 1 },
    })
  })

  it('includes replace the defaults: whatever they leave out is configured', () => {
    expect(pathFilterSkips(paths, ['src/**', 'dist/**'])).toEqual({
      builtIn: { count: 0, paths: [] },
      configured: { count: 2 },
    })
  })

  it('null when nothing was skipped', () => {
    expect(pathFilterSkips(['src/a.ts'])).toBeNull()
    expect(pathFilterSkips([])).toBeNull()
  })

  it('names at most REVIEW_PATH_SKIPS_MAX_PATHS built-in paths, counts all', () => {
    const many = Array.from({ length: 30 }, (_, i) => `dist/f${i}.js`)
    const out = pathFilterSkips(many)
    expect(out?.builtIn.count).toBe(30)
    expect(out?.builtIn.paths).toHaveLength(REVIEW_PATH_SKIPS_MAX_PATHS)
    expect(out?.builtIn.paths[0]).toBe('dist/f0.js')
  })

  it('a path listed twice is counted once', () => {
    expect(pathFilterSkips(['dist/a.js', 'dist/a.js'])?.builtIn.count).toBe(1)
  })
})

describe('parseReviewPathSkips (LUM-1215)', () => {
  it('reads back what pathFilterSkips wrote', () => {
    const rec = pathFilterSkips(['dist/a.js', 'docs/x.md'], ['!docs/**'])
    expect(parseReviewPathSkips(JSON.parse(JSON.stringify(rec)))).toEqual(rec)
  })

  it.each([
    null,
    undefined,
    'x',
    [],
    {},
    { builtIn: { count: 1, paths: ['a'] } },
    { builtIn: { count: -1, paths: [] }, configured: { count: 0 } },
    { builtIn: { count: 1, paths: [1] }, configured: { count: 0 } },
    { builtIn: { count: 0, paths: ['a'] }, configured: { count: 0 } },
    { builtIn: { count: 0, paths: [] }, configured: { count: 0 } },
    { builtIn: { count: 1.5, paths: [] }, configured: { count: 0 } },
  ])('%p is not a record → null', raw => {
    expect(parseReviewPathSkips(raw)).toBeNull()
  })
})
