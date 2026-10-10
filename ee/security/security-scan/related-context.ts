/**
 * LUM-988 — cross-file context for the AI review: code elsewhere in the
 * repository that the diff touches through names, not through files. The
 * review already sees the changed files in full; what it cannot see is who
 * calls a function the PR changes, and what a function the added code calls
 * actually does. Both are where "the reviewer only saw the diff" findings go
 * wrong, in both directions (false positives about callees it imagines, and
 * missed bugs a caller exposes).
 *
 * Search is abstracted (`RelatedSearch`): ripgrep over a local checkout in the
 * replay, the sandbox VM's checkout in production. Everything else here is
 * pure and deterministic, so the replay measures what production would send.
 */
import { isSkippedContextPath, isTestPath } from './review-context'

/** One search hit: a repo-relative path and a 1-based line. */
export interface RelatedHit {
  path: string
  line: number
}

export interface RelatedSearch {
  /** Whole-word, fixed-string search for `name`; at most `max` hits. */
  usages(name: string, max: number): Promise<RelatedHit[]>
  /** Lines that look like a definition of `name`; at most `max` hits. */
  definitions(name: string, max: number): Promise<RelatedHit[]>
  /** File content at the PR head, or null when absent. */
  read(path: string): Promise<string | null>
}

export interface DiffSymbols {
  /** Functions / classes / methods the diff adds, removes or edits inside. */
  defined: string[]
  /** Distinctive names the added lines call that the diff does not define. */
  called: string[]
}

/** Names too common to say anything when searched across a repository. */
const STOP = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'function',
  'super',
  'this',
  'self',
  'print',
  'println',
  'printf',
  'console',
  'require',
  'import',
  'export',
  'typeof',
  'instanceof',
  'new',
  'await',
  'async',
  'yield',
  'lambda',
  'assert',
  'raise',
  'throw',
  'elif',
  'else',
  'then',
  'with',
  'when',
  'case',
  'default',
  'delete',
  'void',
  'puts',
  'expect',
  'describe',
  'test',
  'it',
  'beforeEach',
  'afterEach',
  'mock',
  'call',
  'apply',
  'bind',
  'push',
  'pop',
  'shift',
  'slice',
  'splice',
  'join',
  'split',
  'map',
  'filter',
  'reduce',
  'forEach',
  'find',
  'some',
  'every',
  'keys',
  'values',
  'items',
  'entries',
  'get',
  'set',
  'has',
  'add',
  'append',
  'extend',
  'update',
  'remove',
  'insert',
  'format',
  'replace',
  'strip',
  'trim',
  'lower',
  'upper',
  'toString',
  'valueOf',
  'equals',
  'hashCode',
  'length',
  'size',
  'len',
  'str',
  'int',
  'float',
  'bool',
  'list',
  'dict',
  'tuple',
  'range',
  'sorted',
  'reversed',
  'enumerate',
  'zip',
  'isinstance',
  'getattr',
  'setattr',
  'hasattr',
  'open',
  'close',
  'read',
  'write',
  'send',
  'then',
  'catch',
  'finally',
  'resolve',
  'reject',
  'parse',
  'stringify',
  'String',
  'Number',
  'Boolean',
  'Object',
  'Array',
  'Promise',
  'Error',
  'Date',
  'Math',
  'JSON',
  'Map',
  'Set',
  'List',
  'Optional',
  'of',
  'from',
  'main',
  'init',
  'run',
  'start',
  'stop',
  'render',
  'setState',
  'useState',
  'useEffect',
  'useMemo',
  'useCallback',
  'useRef',
  'sprintf',
  'Sprintf',
  'Errorf',
  'Printf',
  'make',
  'append',
  'panic',
  'defer',
  'Get',
  'Set',
  'func',
  'object',
  'number',
  'string',
  'status',
  'json',
  'info',
  'debug',
  'warn',
  'error',
  'create',
  'execute',
  'handler',
  'handle',
  'value',
  'data',
  'name',
  'type',
  'item',
  'result',
  'response',
  'request',
  'config',
  'options',
  'params',
  'indexOf',
  'createElement',
  'appendChild',
  'getElementById',
  'querySelector',
  'addEventListener',
  'removeEventListener',
  'encodeURIComponent',
  'decodeURIComponent',
  'fetch',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'parseInt',
  'parseFloat',
  'getInstance',
  'getClass',
  'getName',
  'getValue',
  'toLowerCase',
  'toUpperCase',
  'startsWith',
  'endsWith',
  'contains',
  'isEmpty',
  'includes',
])

const DEFINITION_PATTERNS: RegExp[] = [
  /\bdef\s+(?:self\.)?([A-Za-z_]\w*)/g,
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g,
  /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/g,
  /\b(?:class|interface|struct|enum|module|trait)\s+([A-Za-z_]\w*)/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
]

/** A method declaration on an added/removed line (JS/TS class, Java, C#). */
const METHOD_DECL =
  /^\s*(?:(?:public|private|protected|static|async|override|final|synchronized|abstract|export|default)\s+)*(?:[\w<>[\],.?]+\s+)?([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?::\s*[^{=]+)?(?:throws\s+[\w., ]+)?\s*\{\s*$/

const CALL = /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(|\.([A-Za-z_$][\w$]*)\s*\(/g

const MIN_NAME = 4

function distinctive(name: string): boolean {
  return (
    name.length >= MIN_NAME && !STOP.has(name) && !/^[A-Z0-9_]+$/.test(name)
  )
}

/**
 * PURE — the names a unified diff defines (on added/removed lines and in
 * hunk headers) and calls (on added lines), in first-seen order.
 */
export function extractDiffSymbols(diff: string): DiffSymbols {
  const defined: string[] = []
  const calledCount = new Map<string, number>()
  const addDefined = (n: string | undefined) => {
    if (n && distinctive(n) && !defined.includes(n)) defined.push(n)
  }
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++') || raw.startsWith('---')) continue
    const header = raw.startsWith('@@') ? raw.replace(/^@@[^@]*@@/, '') : null
    const changed = raw.startsWith('+') || raw.startsWith('-')
    if (header === null && !changed) continue
    const line = header ?? raw.slice(1)
    for (const re of DEFINITION_PATTERNS) {
      re.lastIndex = 0
      for (const m of line.matchAll(re)) addDefined(m[1])
    }
    if (changed) {
      const decl = METHOD_DECL.exec(line)
      if (decl && !STOP.has(decl[1]!)) addDefined(decl[1])
    }
    if (raw.startsWith('+')) {
      CALL.lastIndex = 0
      for (const m of line.matchAll(CALL)) {
        const n = m[1] ?? m[2]
        if (n && distinctive(n))
          calledCount.set(n, (calledCount.get(n) ?? 0) + 1)
      }
    }
  }
  const called = [...calledCount.keys()].filter(n => !defined.includes(n))
  return { defined, called }
}

/** Lines around a caller hit, and from a definition into its body. */
export const RELATED_CALLER_WINDOW = { before: 4, after: 4 }
export const RELATED_DEFINITION_WINDOW = { before: 2, after: 14 }
/** Symbols searched per kind, hits kept per symbol, and the noise cut-off. */
export const RELATED_MAX_SYMBOLS = 12
export const RELATED_MAX_CALLERS = 3
export const RELATED_MAX_DEFINITIONS = 2
/** A name with more usages than this is too generic to be worth context. */
export const RELATED_MAX_USAGES = 25
export const RELATED_MAX_CHARS = 40_000

export interface RelatedSnippet {
  path: string
  /** 1-based, inclusive. */
  start: number
  end: number
  why: string
}

/**
 * PURE — merge overlapping windows per file (keeping the first reason) and
 * pack them under `maxChars`, callers and definitions in the order given;
 * a snippet that does not fit is skipped, the next is still tried.
 */
export function packRelatedSnippets(
  snippets: readonly RelatedSnippet[],
  files: ReadonlyMap<string, string[]>,
  maxChars: number
): { text: string; included: number } {
  const merged: RelatedSnippet[] = []
  for (const s of snippets) {
    const prev = merged.find(
      m => m.path === s.path && s.start <= m.end + 1 && s.end >= m.start - 1
    )
    if (prev) {
      prev.start = Math.min(prev.start, s.start)
      prev.end = Math.max(prev.end, s.end)
    } else merged.push({ ...s })
  }
  let text = ''
  let included = 0
  for (const s of merged) {
    const lines = files.get(s.path)
    if (!lines) continue
    const start = Math.max(1, s.start)
    const end = Math.min(lines.length, s.end)
    if (end < start) continue
    const block = `=== ${s.path}:${start}-${end} (${s.why}) ===\n${lines.slice(start - 1, end).join('\n')}\n`
    if (text.length + block.length > maxChars) continue
    text += block
    included++
  }
  return { text, included }
}

/**
 * PURE — how many leading directories `path` shares with the nearest of
 * `paths` (`a/b/c.ts` vs `a/b/d.ts` → 2, vs `a/x/y.ts` → 1, vs `z.ts` → 0).
 */
export function pathProximity(path: string, paths: readonly string[]): number {
  const dirs = path.split('/').slice(0, -1)
  let best = 0
  for (const other of paths) {
    const od = other.split('/').slice(0, -1)
    let n = 0
    while (n < dirs.length && n < od.length && dirs[n] === od[n]) n++
    if (n > best) best = n
  }
  return best
}

export interface LoadedRelatedContext {
  text: string
  symbols: DiffSymbols
  snippets: number
  error: string | null
}

/**
 * Find callers of what the diff defines and definitions of what it calls,
 * outside the changed files (the review has those in full), non-test files
 * first. Never throws: a failed search returns no related context.
 */
export async function loadRelatedContext(opts: {
  diff: string
  changedPaths: readonly string[]
  search: RelatedSearch
  maxChars?: number
}): Promise<LoadedRelatedContext> {
  const symbols = extractDiffSymbols(opts.diff)
  const changed = new Set(opts.changedPaths)
  const maxChars = opts.maxChars ?? RELATED_MAX_CHARS
  if (maxChars <= 0) return { text: '', symbols, snippets: 0, error: null }
  const keep = (h: RelatedHit) =>
    !changed.has(h.path) && !isSkippedContextPath(h.path)
  const near = (h: RelatedHit) => pathProximity(h.path, opts.changedPaths)
  const byRelevance = (a: RelatedHit, b: RelatedHit) =>
    near(b) - near(a) || Number(isTestPath(a.path)) - Number(isTestPath(b.path))
  try {
    const snippets: RelatedSnippet[] = []
    for (const name of symbols.defined.slice(0, RELATED_MAX_SYMBOLS)) {
      const hits = await opts.search.usages(name, RELATED_MAX_USAGES + 1)
      if (hits.length > RELATED_MAX_USAGES) continue
      for (const h of hits
        .filter(keep)
        .sort(byRelevance)
        .slice(0, RELATED_MAX_CALLERS))
        snippets.push({
          path: h.path,
          start: h.line - RELATED_CALLER_WINDOW.before,
          end: h.line + RELATED_CALLER_WINDOW.after,
          why: `uses ${name}`,
        })
    }
    for (const name of symbols.called.slice(0, RELATED_MAX_SYMBOLS)) {
      const hits = await opts.search.definitions(
        name,
        RELATED_MAX_DEFINITIONS + 3
      )
      // Defined in many places = a common name; any pick would be a guess.
      if (hits.length > RELATED_MAX_DEFINITIONS + 2) continue
      // A definition far from every changed file is most likely a library
      // or unrelated namesake (DOM, JDK, another package's Debug).
      for (const h of hits
        .filter(h => keep(h) && near(h) >= 1)
        .sort(byRelevance)
        .slice(0, RELATED_MAX_DEFINITIONS))
        snippets.push({
          path: h.path,
          start: h.line - RELATED_DEFINITION_WINDOW.before,
          end: h.line + RELATED_DEFINITION_WINDOW.after,
          why: `defines ${name}`,
        })
    }
    const files = new Map<string, string[]>()
    for (const p of new Set(snippets.map(s => s.path))) {
      const body = await opts.search.read(p)
      if (body !== null) files.set(p, body.split('\n'))
    }
    const packed = packRelatedSnippets(snippets, files, maxChars)
    return {
      text: packed.text,
      symbols,
      snippets: packed.included,
      error: null,
    }
  } catch (e) {
    return {
      text: '',
      symbols,
      snippets: 0,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
