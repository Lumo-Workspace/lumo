/**
 * LUM-917 — AI-derived content (memories, session summaries, run summaries)
 * must not carry raw code. The generating prompts say so
 * (`DERIVED_CONTENT_NO_CODE_RULE`); this is the mechanical half that runs on
 * every write, so a model that ignores the rule — or a hand-written memory
 * that pastes a snippet — still stores prose only.
 *
 * What counts as code (conservative: prose and short inline references such
 * as a file path or a one-line command in backticks survive):
 *   - fenced blocks (``` / ~~~), closed or running to the end of the text;
 *   - a line that reads as source code: an import/export, a declaration, a
 *     control-flow header, a statement ending in `;` or `{`, a lone closing
 *     bracket, a markup tag, a `#include` / `package` / `using` line;
 *   - a long minified-looking line (dense punctuation, almost no spaces);
 *   - an inline code span longer than `MAX_INLINE_CODE_CHARS`.
 * Each removed run becomes one `CODE_OMITTED_MARKER`. Credential redaction is
 * separate and unchanged (`redactStoredFields`).
 */

export const CODE_OMITTED_MARKER = '[code omitted]'

/** Inline `code` spans longer than this are treated as pasted code. */
export const MAX_INLINE_CODE_CHARS = 80

/** Lines at least this long are checked for the minified-code shape. */
const MINIFIED_MIN_CHARS = 160

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/

const CODE_LINE_PATTERNS: readonly RegExp[] = [
  // ES / TS / Python / Java imports and exports
  /^import\s+[\w*{][^\n]*\sfrom\s+['"`][^'"`]+['"`];?$/,
  /^import\s+['"`][^'"`]+['"`];?$/,
  /^import\s+[\w.]+(\s+as\s+\w+)?;?$/,
  /^from\s+[\w.]+\s+import\s+[\w*(]/,
  /^export\s+(default\s+)?(async\s+)?(const|let|var|function|class|interface|type|enum)\b/,
  /^export\s*(\*|\{)/,
  /^(module\.)?exports(\.\w+)?\s*=/,
  // declarations
  /^(const|let|var)\s+[\w$[\]{},\s]+?\s*(:\s*[^=]+)?=\s*\S/,
  /^(async\s+)?function\s*\*?\s*[\w$]*\s*\(/,
  /^(def|fn|func)\s+[\w$]+\s*[(<]/,
  /^(abstract\s+)?class\s+[\w$]+[^\n]*[{:]$/,
  /^(interface|enum|struct)\s+[\w$]+[^\n]*\{$/,
  /^type\s+[\w$]+(<[^>]*>)?\s*=\s*\S/,
  /^(public|private|protected|static|final)\s+[\w<>[\],\s]+\(/,
  // control flow headers and bare statements
  /^(if|for|while|switch|catch|elif|else\s+if)\s*\(.*\)\s*\{?$/,
  /^(}\s*)?else\s*\{$/,
  /^(return|throw|await|yield)\b[^\n]*;$/,
  // preprocessor / package lines
  /^#include\s*[<"]/,
  /^package\s+[\w.]+;?$/,
  /^using\s+[\w.]+;$/,
  // a lone closing bracket run: `}`, `});`, `],`
  /^[}\])]+[;,)]*$/,
  // a markup / JSX tag on its own line
  /^<\/?[A-Za-z][\w.:-]*(\s+[\w:@.-]+(=("[^"]*"|'[^']*'|\{[^}]*\}))?)*\s*\/?>$/,
]

/** A statement shape: ends in `;` or `{` and has a call or an assignment. */
function looksLikeStatement(line: string): boolean {
  if (!/[;{]$/.test(line)) return false
  return /[\w$\])]\s*\(|\s=\s|=>|::|->/.test(line)
}

function looksMinified(line: string): boolean {
  if (line.length < MINIFIED_MIN_CHARS) return false
  const spaces = (line.match(/\s/g) ?? []).length
  const symbols = (line.match(/[{}()[\];=<>]/g) ?? []).length
  return spaces / line.length < 0.08 && symbols / line.length > 0.06
}

/** Is this one line (bullet marker aside) source code rather than prose? */
export function isCodeLikeLine(rawLine: string): boolean {
  const line = rawLine.trim().replace(/^([-*+]|\d+[.)])\s+/, '')
  if (line.length === 0) return false
  if (CODE_LINE_PATTERNS.some(p => p.test(line))) return true
  return looksLikeStatement(line) || looksMinified(line)
}

export interface StripCodeResult {
  text: string
  /** Code runs (fenced blocks, code-line runs, long inline spans) removed. */
  removed: number
}

function stripInlineSpans(line: string, counter: { n: number }): string {
  return line.replace(/`([^`\n]+)`/g, (whole, inner: string) => {
    if (inner.length <= MAX_INLINE_CODE_CHARS) return whole
    counter.n++
    return CODE_OMITTED_MARKER
  })
}

const MID_LINE_FENCE = /^(.*\S)\s*((`{3,}|~{3,}).*)$/

/**
 * A fence opened after prose on the same line ("Added ```ts") starts on a
 * line of its own, so the fence scan below sees it.
 */
function splitMidLineFences(lines: string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    const m = FENCE_OPEN.test(line) ? null : MID_LINE_FENCE.exec(line)
    if (m && !m[1]!.includes('`')) {
      out.push(m[1]!, m[2]!)
    } else {
      out.push(line)
    }
  }
  return out
}

/**
 * `text` with every code run replaced by one `CODE_OMITTED_MARKER`. Returns
 * the input string unchanged (same value) when nothing looked like code.
 */
export function stripCodeFromText(text: string): StripCodeResult {
  if (text.length === 0) return { text, removed: 0 }
  const lines = splitMidLineFences(text.split('\n'))
  const out: string[] = []
  const counter = { n: 0 }
  // True while the last emitted non-blank line is a marker, so a run of code
  // lines (blank lines inside it included) collapses into one marker.
  let inRun = false
  let pendingBlanks: string[] = []

  const emitMarker = () => {
    if (!inRun) {
      out.push(...pendingBlanks)
      out.push(CODE_OMITTED_MARKER)
      counter.n++
      inRun = true
    }
    pendingBlanks = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fence = FENCE_OPEN.exec(line)
    if (fence) {
      const closer = fence[1]!
      let j = i + 1
      while (j < lines.length && !lines[j]!.trim().startsWith(closer)) j++
      i = j // skip through the closing fence (or the end of the text)
      emitMarker()
      continue
    }
    if (line.trim().length === 0) {
      pendingBlanks.push(line)
      continue
    }
    if (isCodeLikeLine(line)) {
      emitMarker()
      continue
    }
    out.push(...pendingBlanks)
    pendingBlanks = []
    inRun = false
    out.push(stripInlineSpans(line, counter))
  }
  out.push(...pendingBlanks)

  if (counter.n === 0) return { text, removed: 0 }
  return { text: out.join('\n'), removed: counter.n }
}

function isPlainJson(value: unknown): boolean {
  if (Array.isArray(value)) return true
  if (!value || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Deep pass over a stored JSON value: every string is run through
 * `stripCodeFromText`. Returns the same reference when nothing changed,
 * otherwise a copy rebuilt along every changed path (the caller's object is
 * never mutated). Non-plain objects (Prisma sentinels, Dates) pass through.
 */
export function stripCodeFromJson(value: unknown): {
  value: unknown
  removed: number
} {
  const counter = { n: 0 }
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = stripCodeFromText(v)
      counter.n += r.removed
      return r.text
    }
    if (!isPlainJson(v)) return v
    if (Array.isArray(v)) {
      let changed = false
      const next = v.map(item => {
        const child = walk(item)
        if (child !== item) changed = true
        return child
      })
      return changed ? next : v
    }
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(v as Record<string, unknown>)) {
      const child = walk(item)
      if (child !== item) changed = true
      next[key] = child
    }
    return changed ? next : v
  }
  const next = walk(value)
  return { value: next, removed: counter.n }
}

/**
 * `data` with every listed field stripped of code — the code-free twin of
 * `redactStoredFields` (lib/security-scan/storage-redaction.ts). Returns the
 * same object when nothing matched.
 */
export function stripCodeFromStoredFields<T extends object>(
  data: T,
  fields: readonly string[]
): T {
  let next: Record<string, unknown> | null = null
  const source = data as Record<string, unknown>
  for (const field of fields) {
    if (!(field in source)) continue
    const value = source[field]
    const stripped = stripCodeFromJson(value).value
    if (stripped === value) continue
    next ??= { ...source }
    next[field] = stripped
  }
  return (next ?? data) as T
}

/**
 * The prompt half: appended to every prompt that writes a memory, a session
 * summary or a run summary.
 */
export const DERIVED_CONTENT_NO_CODE_RULE = `No-code rule (mandatory): never copy source code into your output — no code blocks, no multi-line snippets, no pasted lines of code, diffs, stack traces or file contents. Describe what the code does in plain words instead. A file path, a symbol name or a short single command written inline is fine. (Where the output schema asks for a verbatim grounding \`quote\`, that one field may still quote the source; it is never stored.)`
