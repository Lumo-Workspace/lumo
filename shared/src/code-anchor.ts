/**
 * LUM-547 (P4b) — code-anchor staleness detection.
 *
 * Pure logic: parse a memory's flattened text for high-confidence references to
 * code "anchors" (file paths, symbols, flag/constant names), then — given an
 * injected existence probe — decide whether the whole memory is stale (every
 * anchor it names is gone from the repo).
 *
 * 高精度优先 / 宁缺毋滥: anchor extraction errs toward under-extraction
 * (symbols & flags must be backtick-guarded; paths must be path-shaped with a
 * known extension), and the staleness verdict errs toward keeping a memory (any
 * single surviving anchor spares the whole memory). Detection only proposes a
 * candidate; a human confirms before anything is archived (see retire.service).
 */

export type AnchorKind = 'file' | 'symbol' | 'flag'

export interface CodeAnchor {
  kind: AnchorKind
  value: string
}

/** Existence probe over the current repo — injected (DIP) so the pure anchor
 * logic is testable without git/fs. Implementations resolve against
 * git-tracked files / exact word-boundary grep, never the dirty working tree. */
export interface AnchorProbe {
  /** True when the repo-relative path is tracked in git. */
  fileExists(path: string): boolean
  /** True when the symbol/flag name occurs (word-boundary exact) anywhere in the repo. */
  symbolExists(name: string): boolean
}

const KNOWN_EXT =
  'ts|tsx|js|jsx|mjs|cjs|json|prisma|md|mdx|css|scss|sass|sql|sh|yml|yaml|html|toml'

// A repo-relative path: one or more "dir/" segments then a filename.ext.
const PATH_RE = new RegExp(
  String.raw`(?<![\w@/.])((?:[\w.-]+/)+[\w.-]+\.(?:${KNOWN_EXT}))\b`,
  'g'
)

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const SCREAMING_SNAKE_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/
// "Compound" identifier: camelCase, snake_case, or PascalCase-with-transition.
const COMPOUND_RE = /[a-z][A-Z]|_|^[A-Z][a-z0-9]+[A-Z]/

function isExternalPath(p: string): boolean {
  return (
    p.startsWith('@') ||
    p.startsWith('node_modules/') ||
    p.includes('/node_modules/')
  )
}

/**
 * Extract high-confidence code anchors from flattened memory text.
 * - File paths: path-shaped tokens with a known extension (bare or backticked),
 *   excluding URLs and external packages.
 * - Symbols: backtick-wrapped compound identifiers (camel/snake/Pascal), with
 *   single plain words and stop-words excluded.
 * - Flags: backtick-wrapped SCREAMING_SNAKE constants.
 * Result is de-duplicated, first-seen order.
 */
export function extractAnchors(text: string): CodeAnchor[] {
  const out: CodeAnchor[] = []
  const seen = new Set<string>()
  const push = (kind: AnchorKind, value: string) => {
    const key = `${kind}::${value}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ kind, value })
  }

  // Strip URLs so their path-looking tails are never mistaken for repo paths.
  const deUrled = text.replace(/https?:\/\/\S+/g, ' ')

  // File paths (from anywhere in the text).
  PATH_RE.lastIndex = 0
  for (let m = PATH_RE.exec(deUrled); m != null; m = PATH_RE.exec(deUrled)) {
    const p = m[1]
    if (p && !isExternalPath(p)) push('file', p)
  }

  // Symbols & flags (backtick-guarded only).
  const backtickRe = /`([^`]+)`/g
  for (let m = backtickRe.exec(text); m != null; m = backtickRe.exec(text)) {
    const inner = (m[1] ?? '').trim()
    if (!IDENT_RE.test(inner)) continue // has spaces / slashes / dots → not a bare identifier
    if (SCREAMING_SNAKE_RE.test(inner)) {
      push('flag', inner)
      continue
    }
    if (inner.length >= 3 && COMPOUND_RE.test(inner)) {
      push('symbol', inner)
    }
  }

  return out
}

export interface StaleVerdict {
  /** True only when the memory has ≥1 anchor and EVERY anchor is absent. */
  stale: boolean
  /** Anchors that the probe could not find (evidence for the human reviewer). */
  deadAnchors: CodeAnchor[]
  /** How many anchors were extracted (0 → not a candidate). */
  anchorsFound: number
}

function anchorExists(a: CodeAnchor, probe: AnchorProbe): boolean {
  return a.kind === 'file'
    ? probe.fileExists(a.value)
    : probe.symbolExists(a.value)
}

/**
 * Decide whether a memory's text is code-anchor stale. A memory is a stale
 * candidate only when it names at least one anchor and EVERY anchor it names is
 * absent from the repo (any single survivor spares it — the mis-kill guard). An
 * anchor-free memory is never a candidate. `deadAnchors` always reports the
 * absent anchors found (useful as evidence even when the memory is not stale).
 */
export function classifyMemoryStaleness(
  text: string,
  probe: AnchorProbe
): StaleVerdict {
  const anchors = extractAnchors(text)
  const deadAnchors = anchors.filter(a => !anchorExists(a, probe))
  const stale = anchors.length > 0 && deadAnchors.length === anchors.length
  return { stale, deadAnchors, anchorsFound: anchors.length }
}
