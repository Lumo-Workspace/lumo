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

export interface JsonArrayFilterTransform {
  file: string
  type: 'jsonArrayFilter'
  /** Key path of the array, e.g. ["crons"]. */
  path: string[]
  /** Object key whose string value is tested, e.g. "path". */
  key: string
  /** Elements whose `key` matches this regex (JS source) are removed. */
  pattern: string
  reason: string
}

/**
 * LUM-1078: replace every match of a multiline regex — used to cut a whole
 * section (or one phrase) of a file that also serves the private repository,
 * without marker comments in the source. A pattern that matches nothing
 * leaves the file unchanged, like the other transforms; what must be gone is
 * guarded separately by a file-scoped forbidden marker, so a renamed
 * heading fails the export instead of leaking the section.
 */
export interface ReplaceTransform {
  file: string
  type: 'replace'
  /** JS regex source, compiled with the `g` and `m` flags. */
  pattern: string
  /** Replacement text (`$1` etc. refer to capture groups). */
  replacement: string
  reason: string
}

/**
 * LUM-1081: rewrite the top-level keys of flat JSON message files (the
 * `lib/i18n/*.json` locales). Keys matching `delete` are removed; then every
 * key `<promote><key>` replaces the value of `<key>` (which must exist — a
 * stale variant fails the export rather than shipping the hosted text) and is
 * itself removed. The private repo keeps the snapshot's wording as ordinary,
 * translated `oss.*` keys, so every locale's parity check covers it.
 * `file` may be a glob (see `transformTargets`).
 */
export interface LocaleKeysTransform {
  file: string
  type: 'localeKeys'
  /** JS regex source tested against each top-level key; matches are removed. */
  delete?: string
  /** Key prefix of the snapshot variants, e.g. "oss.". */
  promote?: string
  reason: string
}

export type Transform =
  | JsonDeleteTransform
  | DropLinesTransform
  | JsonArrayFilterTransform
  | ReplaceTransform
  | LocaleKeysTransform

export interface ForbiddenMarker {
  id: string
  /** JS regex source; matched case-sensitively per line. */
  pattern: string
  /**
   * LUM-1078: globs limiting the marker to these snapshot files (e.g. the
   * docs and `.env.example`, where a plugin setting must not appear while
   * core code may still name it). Omitted = every file.
   */
  files?: string[]
  reason: string
}

export interface OssManifest {
  include: ManifestRule[]
  exclude: ManifestRule[]
  /** Directory (repo-relative) whose files are copied over the snapshot. */
  overlayDir?: string
  transforms?: Transform[]
  forbiddenMarkers?: ForbiddenMarker[]
  /**
   * Snapshot config files whose path-like tokens must exist in the snapshot.
   * Raw JSON; validated by parseConfigRefFiles (each entry must declare the
   * base its tool resolves relative paths against).
   */
  configRefFiles?: unknown[]
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
  // ESM-style TypeScript imports name the emitted file: `./x.js` → `./x.ts`.
  const js = /\.(m|c)?jsx?$/.exec(base)
  if (js) {
    const stem = base.slice(0, -js[0].length)
    for (const ext of ['.ts', '.tsx', '.mts', '.cts']) {
      if (files.has(stem + ext)) return stem + ext
    }
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

/**
 * LUM-1081: the snapshot files a transform applies to. A `file` without glob
 * characters names one file (as before); with `*` it applies to every
 * matching snapshot file. Empty = the target is missing (the export fails).
 */
export function transformTargets(
  t: Pick<Transform, 'file'>,
  snapshotFiles: readonly string[]
): string[] {
  if (!/[*?]/.test(t.file))
    return snapshotFiles.includes(t.file) ? [t.file] : []
  return snapshotFiles.filter(f => matchesGlob(f, t.file)).sort()
}

function rewriteLocaleKeys(content: string, t: LocaleKeysTransform): string {
  const json = JSON.parse(content) as Record<string, unknown>
  const del = t.delete ? new RegExp(t.delete) : null
  const prefix = t.promote ?? ''
  const out: Record<string, unknown> = {}
  let changed = false
  for (const [key, value] of Object.entries(json)) {
    if ((prefix && key.startsWith(prefix)) || (del && del.test(key))) {
      changed = true
      continue
    }
    out[key] = value
  }
  if (prefix) {
    for (const [key, value] of Object.entries(json)) {
      if (!key.startsWith(prefix)) continue
      const target = key.slice(prefix.length)
      if (!(target in out))
        throw new Error(
          `localeKeys: ${key} has no ${target} to replace (removed or renamed?)`
        )
      out[target] = value
    }
  }
  if (!changed) return content
  return `${JSON.stringify(out, null, 2)}\n`
}

export function applyTransform(content: string, t: Transform): string {
  if (t.type === 'jsonArrayFilter') return filterJsonArray(content, t)
  if (t.type === 'localeKeys') return rewriteLocaleKeys(content, t)
  if (t.type === 'replace')
    return content.replace(new RegExp(t.pattern, 'gm'), t.replacement)
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

/**
 * LUM-1065: drop the elements of a JSON array whose `key` matches `pattern`
 * (e.g. the plugin's `crons` in vercel.json). A missing array is not an
 * error, for the same reason as a missing jsonDelete key; nothing removed
 * leaves the file byte-identical.
 */
function filterJsonArray(content: string, t: JsonArrayFilterTransform): string {
  const json = JSON.parse(content) as Record<string, unknown>
  let node: unknown = json
  for (const key of t.path.slice(0, -1)) {
    node =
      node && typeof node === 'object'
        ? (node as Record<string, unknown>)[key]
        : undefined
  }
  const last = t.path[t.path.length - 1]
  if (last === undefined || !node || typeof node !== 'object') return content
  const arr = (node as Record<string, unknown>)[last]
  if (!Array.isArray(arr)) return content
  const re = new RegExp(t.pattern)
  const kept = arr.filter(el => {
    const v =
      el && typeof el === 'object'
        ? (el as Record<string, unknown>)[t.key]
        : undefined
    return !(typeof v === 'string' && re.test(v))
  })
  if (kept.length === arr.length) return content
  ;(node as Record<string, unknown>)[last] = kept
  return `${JSON.stringify(json, null, 2)}\n`
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

export interface ImportCheckInput {
  /** Files whose imports are checked (exported or overlaid). */
  importers: string[]
  /** Tracked files that stay private and are not replaced by the overlay. */
  excluded: string[]
}

/**
 * LUM-1065 (RFC §6.3): the import check must see the snapshot as it will be,
 * i.e. after the overlay. An overlay file stands in for whatever the ref has
 * at that path: an excluded file it replaces counts as present (importing it
 * is fine), and its OWN imports are checked instead of the replaced file's.
 * Read overlaid paths from the overlay when checking.
 */
export function importCheckInput(
  cls: Pick<Classification, 'included' | 'excluded'>,
  overlayFiles: readonly string[]
): ImportCheckInput {
  const overlay = new Set(overlayFiles)
  const importers = [
    ...new Set([
      ...cls.included,
      ...overlayFiles.filter(f => CODE_FILE_RE.test(f)),
    ]),
  ]
  return { importers, excluded: cls.excluded.filter(f => !overlay.has(f)) }
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
  const compiled = markers
    .filter(m => !m.files || m.files.some(g => matchesGlob(file, g)))
    .map(m => ({ id: m.id, re: new RegExp(m.pattern) }))
  const hits: MarkerHit[] = []
  content.split('\n').forEach((line, idx) => {
    for (const m of compiled)
      if (m.re.test(line)) hits.push({ file, line: idx + 1, markerId: m.id })
  })
  return hits
}

const PATH_TOKEN_RE =
  /(?:^|[\s"'`=(])((?:\.\/[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)*|[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+)\.(?:ts|tsx|js|mjs|cjs|sh|json))(?=$|[\s"'`;)&|])/g

/**
 * Relative file paths mentioned in a config file (scripts, hooks, jest
 * config). A single-segment name only counts when written as `./name.ext`;
 * jest's `<rootDir>/` prefix is read as `./` (rootDir = the config's dir).
 */
export function extractPathTokens(content: string): string[] {
  const out = new Set<string>()
  const text = content.replace(/<rootDir>\//g, './')
  PATH_TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PATH_TOKEN_RE.exec(text)) !== null) {
    const token = m[1]!.replace(/^\.\//, '')
    if (token.startsWith('node_modules/') || token.includes('://')) continue
    out.add(token)
  }
  return [...out]
}

// ---------------------------------------------------------------------------
// Config-reference check
// ---------------------------------------------------------------------------

/**
 * The directory a config's tool resolves relative paths against:
 *   - `root`      — the snapshot root (git hooks run from the repo root;
 *                   lint-staged runs commands from the git root);
 *   - `configDir` — the config file's own directory (npm scripts run in the
 *                   package dir; tsconfig include/extends/baseUrl and jest
 *                   `<rootDir>` are relative to the config file).
 * A token is checked against that ONE base only — a same-named file that
 * exists under the other base does not make the reference valid.
 */
export type ConfigRefBase = 'root' | 'configDir'

export interface ConfigRefFile {
  file: string
  base: ConfigRefBase
  /** Base-relative globs for generated outputs (e.g. `dist/**`). */
  ignore?: string[]
  reason: string
}

const CONFIG_REF_BASES: readonly ConfigRefBase[] = ['root', 'configDir']

/** Validate manifest `configRefFiles`; no entry may leave its base implicit. */
export function parseConfigRefFiles(raw: readonly unknown[]): ConfigRefFile[] {
  return raw.map((e, i) => {
    const where = `configRefFiles[${i}]`
    if (!e || typeof e !== 'object')
      throw new Error(
        `${where}: must be { file, base, reason } — declare the base ("root" | "configDir") its tool resolves paths against`
      )
    const { file, base, ignore, reason } = e as Record<string, unknown>
    if (typeof file !== 'string' || file === '')
      throw new Error(`${where}: missing file`)
    if (!CONFIG_REF_BASES.includes(base as ConfigRefBase))
      throw new Error(
        `${where} (${file}): base must be "root" or "configDir", got ${JSON.stringify(base)}`
      )
    if (typeof reason !== 'string' || reason === '')
      throw new Error(`${where} (${file}): missing reason`)
    if (
      ignore !== undefined &&
      !(Array.isArray(ignore) && ignore.every(g => typeof g === 'string'))
    )
      throw new Error(`${where} (${file}): ignore must be a list of globs`)
    return {
      file,
      base: base as ConfigRefBase,
      ...(ignore !== undefined ? { ignore: ignore as string[] } : {}),
      reason,
    }
  })
}

function baseDirOf(entry: ConfigRefFile): string {
  if (entry.base === 'root') return ''
  const dir = posix.dirname(entry.file)
  return dir === '.' ? '' : dir
}

export interface SnapshotReader {
  /** File content, or null when the file is not in the snapshot. */
  read(path: string): string | null
  exists(path: string): boolean
}

/** `<config> → <token> (resolved against <base>)` for every dangling token. */
export function findDanglingConfigRefs(
  entries: readonly ConfigRefFile[],
  snapshot: SnapshotReader
): string[] {
  const dangling: string[] = []
  for (const entry of entries) {
    const content = snapshot.read(entry.file)
    if (content === null) {
      dangling.push(`${entry.file} (config file itself missing)`)
      continue
    }
    const baseDir = baseDirOf(entry)
    const baseLabel = baseDir ? `${baseDir}/` : 'the snapshot root'
    const ignore = (entry.ignore ?? []).map(globToRegExp)
    for (const token of extractPathTokens(content)) {
      const rel = posix.normalize(token)
      if (ignore.some(re => re.test(rel))) continue
      const target = posix.normalize(posix.join(baseDir, rel))
      const escapes = target === '..' || target.startsWith('../')
      if (escapes || !snapshot.exists(target))
        dangling.push(
          `${entry.file} → ${token} (resolved against ${baseLabel})`
        )
    }
  }
  return dangling
}

/**
 * Files whose relative paths are resolved by a tool. Every one of them that
 * ships must be listed in `configRefFiles`, so none is silently unchecked.
 */
const CONFIG_FILE_RES = [
  /(?:^|\/)package\.json$/,
  /(?:^|\/)tsconfig[^/]*\.json$/,
  /(?:^|\/)jest\.config\.[cm]?[jt]s$/,
  /(?:^|\/)\.lintstagedrc[^/]*$/,
  /(?:^|\/)vercel\.json$/,
  /(?:^|\/)\.husky\/[^/_][^/]*$/,
]

export function isConfigRefCandidate(path: string): boolean {
  return CONFIG_FILE_RES.some(re => re.test(path))
}

/** Snapshot config files that `configRefFiles` does not list (sorted). */
export function findUncoveredConfigFiles(
  snapshotFiles: readonly string[],
  entries: readonly ConfigRefFile[]
): string[] {
  const listed = new Set(entries.map(e => e.file))
  return snapshotFiles
    .filter(f => isConfigRefCandidate(f) && !listed.has(f))
    .sort()
}
