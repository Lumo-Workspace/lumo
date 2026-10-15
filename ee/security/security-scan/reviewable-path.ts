/**
 * LUM-1143 — which changed paths the AI review and the hunt read
 * (CodeRabbit `reviews.path_filters` parity). PURE, shared: the review's
 * input (pr-security-scan.service), its file context (review-context.ts)
 * and the size cap's file count (LUM-1144) all ask `isReviewablePath`.
 *
 * Built-in: lockfiles, minified / source-map / snapshot files, generated
 * code and build output are never reviewed. A repository adds globs:
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
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/node_modules/**',
  '**/vendor/**',
  '**/coverage/**',
])

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
    LOCKFILE_PATH.test(path) || DEFAULT_EXCLUDED_RES.some(r => r.test(path))
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

/** One predicate for a repository's filters (compile once per scan). */
export function reviewablePathPredicate(
  filters: readonly string[] = []
): ReviewablePathPredicate {
  const clean = filters
    .map(f => f.trim())
    .filter(f => invalidPathFilter(f) === null)
  const excludes = clean
    .filter(f => f.startsWith('!'))
    .map(f => globToRegExp(f.slice(1)))
  const includes = clean.filter(f => !f.startsWith('!')).map(globToRegExp)
  return path => {
    if (excludes.some(r => r.test(path))) return false
    if (includes.length > 0) return includes.some(r => r.test(path))
    return !isDefaultExcludedPath(path)
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
