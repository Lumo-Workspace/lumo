/**
 * LUM-1034: pure logic for the default-deny open-source snapshot export.
 *
 * The manifest (oss/manifest.json) classifies EVERY tracked file of a git ref:
 * a file is exported only when an `include` glob matches it and no `exclude`
 * glob does. A file that matches neither is "unclassified" and fails the
 * export, so a new internal directory can never leak silently — someone has to
 * decide which list it belongs to first.
 *
 * Everything here is side-effect free; scripts/oss-export.ts does the git and
 * filesystem work.
 */
import { isAbsolute, posix, relative, sep } from 'node:path'

export interface ManifestRule {
  glob: string
  reason: string
}

export interface JsonDeleteTransform {
  file: string
  type: 'jsonDelete'
  /** Each entry is a key path, e.g. ["scripts", "oss:export"]. */
  paths: string[][]
  reason: string
}

export interface DropLinesTransform {
  file: string
  type: 'dropLines'
  /** Lines matching this regex (JS source, no flags) are removed. */
  pattern: string
  reason: string
}

export type Transform = JsonDeleteTransform | DropLinesTransform

export interface ForbiddenMarker {
  id: string
  /** JS regex source; matched case-sensitively per line. */
  pattern: string
  reason: string
}

export interface OssManifest {
  include: ManifestRule[]
  exclude: ManifestRule[]
  /** Directory (repo-relative) whose files are copied over the snapshot. */
  overlayDir?: string
  transforms?: Transform[]
  forbiddenMarkers?: ForbiddenMarker[]
  /** Snapshot files whose path-like tokens must exist in the snapshot. */
  configRefFiles?: string[]
}

/**
 * True when `target` is neither `dir` itself nor anything below it. A sibling
 * such as `<dir>/..cache` is INSIDE (its relative path merely starts with
 * two dots), so only a real `..` segment counts as leaving the directory.
 */
export function isOutsideDir(dir: string, target: string): boolean {
  const rel = relative(dir, target)
  if (rel === '') return false
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

// ---------------------------------------------------------------------------
// Globs
// ---------------------------------------------------------------------------

/**
 * Minimal glob → RegExp: `**` spans directories, `*` and `?` stay inside one
 * path segment. Patterns are anchored and use `/` separators (git paths).
 */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  let i = 0
  while (i < glob.length) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const prevIsSep = i === 0 || glob[i - 1] === '/'
        const next = glob[i + 2]
        if (prevIsSep && next === '/') {
          // `**/` — zero or more whole directories
          re += '(?:.*/)?'
          i += 3
          continue
        }
        if (prevIsSep && next === undefined) {
          // trailing `/**` (or a bare `**`) — everything below
          re += '.*'
          i += 2
          continue
        }
        re += '.*'
        i += 2
        continue
      }
      re += '[^/]*'
      i += 1
      continue
    }
    if (c === '?') {
      re += '[^/]'
      i += 1
      continue
    }
    re += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c
    i += 1
  }
  return new RegExp(`^${re}$`)
}

export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path)
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface Classification {
  included: string[]
  excluded: string[]
  unclassified: string[]
  /** Rules that matched no file of the ref — likely stale manifest entries. */
  unusedRules: ManifestRule[]
}

export function classifyFiles(
  files: readonly string[],
  manifest: Pick<OssManifest, 'include' | 'exclude'>
): Classification {
  const inc = manifest.include.map(r => ({ r, re: globToRegExp(r.glob) }))
  const exc = manifest.exclude.map(r => ({ r, re: globToRegExp(r.glob) }))
  const used = new Set<ManifestRule>()
  const included: string[] = []
  const excluded: string[] = []
  const unclassified: string[] = []
  for (const f of files) {
    const ex = exc.find(e => e.re.test(f))
    const inMatch = inc.find(e => e.re.test(f))
    if (ex) used.add(ex.r)
    if (inMatch) used.add(inMatch.r)
    if (ex) excluded.push(f)
    else if (inMatch) included.push(f)
    else unclassified.push(f)
  }
  const unusedRules = [...manifest.include, ...manifest.exclude].filter(
    r => !used.has(r)
  )
  return { included, excluded, unclassified, unusedRules }
}

/**
 * Group paths for a readable error: top-level files stay as-is, anything in a
 * directory collapses to `<dir>/ (N files)` at the given depth.
 */
export function summarizePaths(paths: readonly string[], depth = 2): string[] {
  const counts = new Map<string, number>()
  for (const p of paths) {
    const parts = p.split('/')
    const key =
      parts.length <= depth ? p : `${parts.slice(0, depth).join('/')}/`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, n]) => (k.endsWith('/') ? `${k} (${n} files)` : k))
}

// ---------------------------------------------------------------------------
// Import graph guard
// ---------------------------------------------------------------------------

const SPECIFIER_PATTERNS = [
  /\bfrom\s+['"]([^'"\n]+)['"]/g,
  /\bimport\s+['"]([^'"\n]+)['"]/g,
  /\b(?:import|require|require\.resolve|jest\.(?:mock|doMock|unmock|requireActual|requireMock))\s*\(\s*['"]([^'"\n]+)['"]/g,
]

export function extractSpecifiers(source: string): string[] {
  const out = new Set<string>()
  for (const re of SPECIFIER_PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(source)) !== null) out.add(m[1]!)
  }
  return [...out]
}

const RESOLVE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.d.ts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '/index.ts',
  '/index.tsx',
  '/index.js',
]

export const CODE_FILE_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/

/**
 * Resolve a specifier to a repo path in `files`, or null for packages and
 * anything that does not land on a tracked file. `@/x` is the repo-root alias
 * (tsconfig paths / jest moduleNameMapper).
 */
export function resolveSpecifier(
  fromFile: string,
  spec: string,
  files: ReadonlySet<string>
): string | null {
  let base: string
  if (spec.startsWith('@/')) base = spec.slice(2)
  else if (spec.startsWith('./') || spec.startsWith('../'))
    base = posix.join(posix.dirname(fromFile), spec)
  else return null
  base = posix.normalize(base)
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix
    if (files.has(candidate)) return candidate
  }
  return null
}

export interface ImportViolation {
  from: string
  specifier: string
  target: string
}

/** Included code files that import an excluded tracked file. */
export function findImportViolations(
  included: readonly string[],
  excluded: readonly string[],
  readSource: (path: string) => string
): ImportViolation[] {
  const all = new Set([...included, ...excluded])
  const excludedSet = new Set(excluded)
  const violations: ImportViolation[] = []
  for (const file of included) {
    if (!CODE_FILE_RE.test(file)) continue
    for (const spec of extractSpecifiers(readSource(file))) {
      const target = resolveSpecifier(file, spec, all)
      if (target && excludedSet.has(target))
        violations.push({ from: file, specifier: spec, target })
    }
  }
  return violations
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

export function applyTransform(content: string, t: Transform): string {
  if (t.type === 'dropLines') {
    const re = new RegExp(t.pattern)
    return content
      .split('\n')
      .filter(line => !re.test(line))
      .join('\n')
  }
  const json = JSON.parse(content) as Record<string, unknown>
  let deleted = 0
  for (const keyPath of t.paths) {
    let node: unknown = json
    for (const key of keyPath.slice(0, -1)) {
      node =
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[key]
          : undefined
    }
    const last = keyPath[keyPath.length - 1]
    // A missing key is not an error: the ref being exported may predate it
    // (e.g. exporting a commit from before `oss:export` existed). Anything it
    // would have pointed at is still caught by the config-reference check.
    if (last === undefined || !node || typeof node !== 'object') continue
    if (!(last in node)) continue
    delete (node as Record<string, unknown>)[last]
    deleted++
  }
  if (deleted === 0) return content
  // Keep the repo's 2-space JSON style and trailing newline.
  return `${JSON.stringify(json, null, 2)}\n`
}

// ---------------------------------------------------------------------------
// Output scans
// ---------------------------------------------------------------------------

export interface MarkerHit {
  file: string
  line: number
  markerId: string
}

/**
 * Report where forbidden markers occur — file, line and marker id only, never
 * the matched text (a marker can be a credential-shaped pattern).
 */
export function scanMarkers(
  file: string,
  content: string,
  markers: readonly ForbiddenMarker[]
): MarkerHit[] {
  const compiled = markers.map(m => ({ id: m.id, re: new RegExp(m.pattern) }))
  const hits: MarkerHit[] = []
  content.split('\n').forEach((line, idx) => {
    for (const m of compiled)
      if (m.re.test(line)) hits.push({ file, line: idx + 1, markerId: m.id })
  })
  return hits
}

const PATH_TOKEN_RE =
  /(?:^|[\s"'`=(])((?:\.\/)?[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+\.(?:ts|tsx|js|mjs|cjs|sh|json))(?=$|[\s"'`;)&|])/g

/** Repo-relative file paths mentioned in a config file (scripts, hooks). */
export function extractPathTokens(content: string): string[] {
  const out = new Set<string>()
  PATH_TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PATH_TOKEN_RE.exec(content)) !== null) {
    const token = m[1]!.replace(/^\.\//, '')
    if (token.startsWith('node_modules/') || token.includes('://')) continue
    out.add(token)
  }
  return [...out]
}
