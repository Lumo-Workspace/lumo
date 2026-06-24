/**
 * LUM-574 — meta-reasoning guard for per-turn summaries.
 *
 * The turn-summarizer (lib/services/turn-summary) asks a small model for a
 * one-line description of what an agent turn did. Occasionally the model
 * narrates its own deliberation instead — "我们被要求总结…给定的输入是…可能是误解…"
 * — and that raw preamble gets stored as the `turnSummary`. The claim box's
 * DIGEST fallback (no LLM run-summary yet) then surfaces it verbatim, leaking
 * the model's meta-reasoning into the user-facing self-report (seen live in
 * LUM-571 / LUM-540 / LUM-582).
 *
 * This module is the single source of truth for detecting that text. It is
 * pure and dependency-free so the capture layer (turn-summary.service), the CLI
 * read layer (task-claim `selectClaim`), and the web read layer
 * (`deriveRunDigest`) all share ONE definition and cannot drift — the same
 * line is filtered identically on every surface.
 *
 * Detection is deliberately a high-precision, start-anchored prefix match: a
 * legitimate summary is verb-first and never uses 我/我们 (the SYSTEM_PROMPT
 * forbids it), so a clause that opens with a first-person-plural framing or a
 * "given the input / based on / it seems" lede is meta-reasoning, not a
 * summary. Anchoring at the start (rather than substring-anywhere) keeps a
 * legitimate "分析 X" / "查阅 X" / "从 file.ts 删除" from being mistaken for the
 * "分析"/"从文本" meta phrasings.
 */

/** Cap mirrored from the old turn-summary cleanSummary (LUM-481). */
export const MAX_SUMMARY_CHARS = 140

/** Leading quote / bracket wrappers stripped before matching (mirrors the
 *  turn-summary cleaner's quote set). */
const WRAPPER_RE = /^["'`「」“”『』]+|["'`「」“”『』]+$/g

/** Chinese meta-reasoning ledes — the model talking ABOUT the summarization
 *  task instead of producing a summary. Each is matched only at the very start
 *  of the (trimmed, unwrapped) text. */
const META_PREFIXES_ZH = [
  '我们', // 我们被要求 / 我们需要 / 我们分析 / 我们要 — 我/我们 never appears in a real summary
  '我需要',
  '让我',
  '需要基于',
  '需要根据',
  '给定的', // 给定的输入 / 给定的事件
  '给出的', // 给出的是
  '根据给定',
  '根据提供',
  '看起来',
  '可能是误解',
  '可能是理解',
  '从文本',
  '从对话',
  '从给定',
  '输入是',
  '输入的是',
  '这看起来',
  '这似乎',
  '用户说的',
  '用户的对话',
]

/** English equivalents, matched case-insensitively at the start. */
const META_PREFIXES_EN = [
  'we are asked',
  'we need to',
  'we should',
  'let me',
  "let's",
  'the given',
  'looking at',
  'it seems',
  'based on the given',
  'the task is to summarize',
]

/** Collapse whitespace, then strip wrapping quotes/brackets (trimming first so
 *  a space-padded wrapper like `  「…」  ` is still removed). */
function normalize(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.replace(WRAPPER_RE, '').trim()
}

/**
 * True when `text` reads as the summarizer's meta-reasoning preamble rather
 * than an actual turn summary. Empty / whitespace input is not meta-reasoning
 * (the caller treats empty separately).
 */
export function isMetaReasoning(text: string): boolean {
  const s = normalize(text)
  if (s.length === 0) return false
  if (META_PREFIXES_ZH.some(p => s.startsWith(p))) return true
  const lower = s.toLowerCase()
  return META_PREFIXES_EN.some(p => lower.startsWith(p))
}

/**
 * Capture-layer cleaner (LUM-481 normalization + LUM-574 guard): collapse
 * whitespace, strip wrapping quotes, then REJECT meta-reasoning by returning
 * null so it is never written back as a turnSummary. A clean summary is
 * truncated to {@link MAX_SUMMARY_CHARS}. Returns null for empty or rejected
 * input.
 */
export function cleanTurnSummary(raw: string): string | null {
  const single = normalize(raw)
  if (single.length === 0) return null
  if (isMetaReasoning(single)) return null
  if (single.length <= MAX_SUMMARY_CHARS) return single
  return single.slice(0, MAX_SUMMARY_CHARS - 1) + '…'
}

/**
 * Read-layer filter: trim each line, drop the empties and any meta-reasoning,
 * and return the survivors in order. Shared by the CLI digest (`selectClaim`)
 * and the web digest (`deriveRunDigest`) so both surface the same lines.
 */
export function filterMetaReasoning(lines: string[]): string[] {
  return lines
    .map(l => l.trim())
    .filter(l => l.length > 0 && !isMetaReasoning(l))
}
