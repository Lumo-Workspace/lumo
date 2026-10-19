/**
 * LUM-1143 — which changed paths the AI review and the hunt read
 * (repository path filters). PURE, shared: the review's
 * input (pr-security-scan.service), its file context (review-context.ts)
 * and the size cap's file count (LUM-1144) all ask `isReviewablePath`.
 *
 * Built-in: lockfiles, minified / source-map / snapshot files, generated
 * code and build output are never reviewed. LUM-1215: `dist/`, `build/` and
 * `vendor/` count as build output / vendored dependencies only OUTSIDE a
 * source tree (`isBuildOutputPath`) — `src/main/java/…/build/Foo.java` is
 * source and is reviewed. A repository adds globs:
 *  - `!glob` excludes matching paths (always wins);
 *  - `glob` includes: once any include is listed, ONLY matching paths are
 *    reviewed — and an include that matches a built-in exclusion re-admits
 *    that path (so `package-lock.json` reviews the lockfile again).
 *
 * Globs: `**` any number of path segments (`**\/` also zero), `*` and `?`
 * within one segment; a pattern without `/` matches the file name at any
 * depth (`*.lock` = `**\/*.lock`). Paths are repository-relative.
 *
 * The deterministic secret scan and graph rules are NOT filtered: a secret in
 * a lockfile is still a secret.
 */

import type { ReviewPathSkipsInput } from '@/shared/src/security-scan'

/** Dependency lockfiles, by file name. */
export const LOCKFILE_PATH =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Gemfile\.lock|poetry\.lock|Pipfile\.lock|uv\.lock|pdm\.lock|composer\.lock|go\.sum|Cargo\.lock|mix\.lock|pubspec\.lock|Podfile\.lock|packages\.lock\.json|gradle\.lockfile|flake\.lock)$/

/** Built-in exclusions besides lockfiles (generated code, build output). */
export const DEFAULT_EXCLUDED_PATH_GLOBS: readonly string[] = Object.freeze([
  '*.lock',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.snap',
  '*.pb.go',
  '*_pb2.py',
  '*_pb2_grpc.py',
  '*.pb.ts',
  '*.generated.*',
  '*.gen.go',
  '**/__generated__/**',
  '**/.next/**',
  '**/node_modules/**',
  '**/coverage/**',
])

/**
 * LUM-1215 — directory names that hold build output (`dist`, `build`) or
 * vendored dependencies (Go's `vendor`) when they sit at a project root —
 * the repository's or a package's (`packages/ui/dist`, `app/build`) — but
 * are ordinary source directories inside a source tree
 * (`src/main/java/…/build/`, `internal/build/`, `pkg/vendor/`).
 */
export const BUILD_OUTPUT_DIR_NAMES: ReadonlySet<string> = new Set([
  'dist',
  'build',
  'vendor',
])

/**
 * LUM-1215 — path segments (case-insensitive) that mark a source or test
 * tree. An output-named directory BELOW one of them is source, never build
 * output. `app` / `lib` are deliberately absent: `app/build/` is an Android
 * module's output and `lib/` is a common compiler output directory itself.
 */
export const SOURCE_TREE_SEGMENTS: ReadonlySet<string> = new Set([
  'src',
  'source',
  'sources',
  'test',
  'tests',
  '__tests__',
  'spec',
  'specs',
  'main',
  'internal',
  'pkg',
  'cmd',
])

/**
 * LUM-1215 — is `path` inside a `dist/`, `build/` or `vendor/` directory
 * that is build output / vendored dependencies? Pure, path-only (the scan has
 * the changed-file list, not the repository tree): the first such directory
 * counts only when no source-tree segment comes before it, so `dist/src/x.js`
 * is output and `src/dist/x.ts` is source.
 */
export function isBuildOutputPath(path: string): boolean {
  const dirs = path.split('/').slice(0, -1)
  for (const dir of dirs) {
    if (SOURCE_TREE_SEGMENTS.has(dir.toLowerCase())) return false
    if (BUILD_OUTPUT_DIR_NAMES.has(dir)) return true
  }
  return false
}

/** Longest accepted filter; a longer string is a mistake, not a glob. */
export const PATH_FILTER_MAX_LENGTH = 200

function segmentToRegExp(segment: string): string {
  let out = ''
  for (const ch of segment) {
    if (ch === '*') out += '[^/]*'
    else if (ch === '?') out += '[^/]'
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return out
}

/** A glob as an anchored RegExp (see the module comment for the syntax). */
export function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/^\.\//, '').replace(/^\/+/, '')
  const anchored = g.includes('/') ? g : `**/${g}`
  const parts = anchored.split('/')
  let re = ''
  parts.forEach((part, i) => {
    const last = i === parts.length - 1
    if (part === '**') {
      // `**/` = zero or more whole segments; a trailing `**` = anything.
      re += last ? '.*' : '(?:[^/]*/)*'
    } else {
      re += segmentToRegExp(part) + (last ? '' : '/')
    }
  })
  return new RegExp(`^${re}$`)
}

const DEFAULT_EXCLUDED_RES = DEFAULT_EXCLUDED_PATH_GLOBS.map(globToRegExp)

/** A lockfile, generated file or build artifact — not reviewed by default. */
export function isDefaultExcludedPath(path: string): boolean {
  return (
    LOCKFILE_PATH.test(path) ||
    DEFAULT_EXCLUDED_RES.some(r => r.test(path)) ||
    isBuildOutputPath(path)
  )
}

/** Why a path filter is refused (null = fine). */
export function invalidPathFilter(filter: string): string | null {
  const body = filter.startsWith('!') ? filter.slice(1) : filter
  if (body.trim() === '') return 'empty glob'
  if (filter.length > PATH_FILTER_MAX_LENGTH)
    return `longer than ${PATH_FILTER_MAX_LENGTH} characters`
  if (/[\n\r]/.test(filter)) return 'contains a line break'
  return null
}

export type ReviewablePathPredicate = (path: string) => boolean

/**
 * LUM-1215 — why a path is (not) read: `reviewed`, skipped by the built-in
 * defaults (`built_in`), or skipped by the repository's own filters
 * (`configured`: a matching `!glob`, or — once includes are listed — no
 * include matched; includes replace the defaults).
 */
export type PathFilterVerdict = 'reviewed' | 'built_in' | 'configured'

/** One verdict function for a repository's filters (compile once per scan). */
export function pathFilterVerdict(
  filters: readonly string[] = []
): (path: string) => PathFilterVerdict {
  const clean = filters
    .map(f => f.trim())
    .filter(f => invalidPathFilter(f) === null)
  const excludes = clean
    .filter(f => f.startsWith('!'))
    .map(f => globToRegExp(f.slice(1)))
  const includes = clean.filter(f => !f.startsWith('!')).map(globToRegExp)
  return path => {
    if (excludes.some(r => r.test(path))) return 'configured'
    if (includes.length > 0)
      return includes.some(r => r.test(path)) ? 'reviewed' : 'configured'
    return isDefaultExcludedPath(path) ? 'built_in' : 'reviewed'
  }
}

/** One predicate for a repository's filters (compile once per scan). */
export function reviewablePathPredicate(
  filters: readonly string[] = []
): ReviewablePathPredicate {
  const verdict = pathFilterVerdict(filters)
  return path => verdict(path) === 'reviewed'
}

/** Built-in-skipped paths a scan row names; the rest are counted. */
export const REVIEW_PATH_SKIPS_MAX_PATHS = 20

/**
 * LUM-1215 — what the path filters left out of the AI review, as stored on
 * the scan row (`PrSecurityScan.reviewPathSkips`): the built-in defaults'
 * skips by name (first `REVIEW_PATH_SKIPS_MAX_PATHS`, in order) and count,
 * the repository's own filters' by count.
 */
export type ReviewPathSkips = ReviewPathSkipsInput

function count(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0
}

/**
 * LUM-1215 — the stored Json read back defensively: anything that is not a
 * well-formed record (an older row, a hand edit) is null — "nothing to say",
 * never a half-filled notice.
 */
export function parseReviewPathSkips(raw: unknown): ReviewPathSkips | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { builtIn, configured } = raw as Record<string, unknown>
  if (!builtIn || typeof builtIn !== 'object') return null
  if (!configured || typeof configured !== 'object') return null
  const b = builtIn as { count?: unknown; paths?: unknown }
  const c = (configured as { count?: unknown }).count
  if (!count(b.count) || !count(c)) return null
  if (!Array.isArray(b.paths) || !b.paths.every(p => typeof p === 'string'))
    return null
  if (b.paths.length > b.count) return null
  if (b.count === 0 && c === 0) return null
  return {
    builtIn: {
      count: b.count,
      paths: (b.paths as string[]).slice(0, REVIEW_PATH_SKIPS_MAX_PATHS),
    },
    configured: { count: c },
  }
}

/**
 * LUM-1215 — classify the PR's changed paths under the repository's
 * filters. null when nothing was skipped. Paths only: no content.
 */
export function pathFilterSkips(
  paths: readonly string[],
  filters: readonly string[] = []
): ReviewPathSkips | null {
  const verdict = pathFilterVerdict(filters)
  const builtIn: string[] = []
  let configured = 0
  for (const path of new Set(paths)) {
    const v = verdict(path)
    if (v === 'built_in') builtIn.push(path)
    else if (v === 'configured') configured += 1
  }
  if (builtIn.length === 0 && configured === 0) return null
  return {
    builtIn: {
      count: builtIn.length,
      paths: builtIn.slice(0, REVIEW_PATH_SKIPS_MAX_PATHS),
    },
    configured: { count: configured },
  }
}

/** Whether the AI review / hunt reads `path` under the repository's filters. */
export function isReviewablePath(
  path: string,
  filters: readonly string[] = []
): boolean {
  return reviewablePathPredicate(filters)(path)
}

/** The file a `diff --git` section changes, or null when it cannot tell. */
function sectionPath(section: string): string | null {
  const plus = /^\+\+\+ b\/(.+)$/m.exec(section)?.[1]
  if (plus !== undefined) return plus
  // A deletion: `+++ /dev/null`, the path is on the `---` line.
  if (/^\+\+\+ \/dev\/null$/m.test(section))
    return /^--- a\/(.+)$/m.exec(section)?.[1] ?? null
  // Rename / mode-only / binary sections have no +++ line.
  return /^diff --git a\/\S+ b\/(\S+)$/m.exec(section)?.[1] ?? null
}

export interface FilteredDiff {
  diff: string
  /** Paths whose sections were dropped, in diff order. */
  excluded: string[]
  /** Paths whose sections were kept, in diff order. */
  kept: string[]
}

/**
 * The diff without the sections of non-reviewable files. A section whose
 * path cannot be read (quoted / nonstandard header) is kept: exclusion must
 * be proven.
 */
export function filterReviewableDiff(
  diff: string,
  isReviewable: ReviewablePathPredicate
): FilteredDiff {
  const excluded: string[] = []
  const kept: string[] = []
  const out = diff
    .split(/(?=^diff --git )/m)
    .filter(section => {
      if (!section.startsWith('diff --git ')) return true
      const path = sectionPath(section)
      if (path === null) return true
      if (isReviewable(path)) {
        kept.push(path)
        return true
      }
      excluded.push(path)
      return false
    })
    .join('')
  return { diff: out, excluded, kept }
}
