/**
 * LUM-1147 — path instructions and the tone instruction: review guidance
 * the repository's owners write (in Lumo's repository settings or
 * `.lumo.yaml`), added to the AI review's prompt. PURE; the service passes
 * the injection guard in.
 *
 * Workspace-authored prompt text, so:
 *  - it only ever reaches the AI review's prompt, fenced as data and run
 *    line by line through the guard chain. Nothing reads it as a control:
 *    it cannot turn a layer off, mark a finding, approve, or change what
 *    blocks DONE — the deterministic layers never see it;
 *  - it is bounded: entries, characters per entry, and characters rendered
 *    per review (`REVIEW_PATH_INSTRUCTIONS_MAX_CHARS`, the same size as the
 *    learnings block), and it is paid for out of the review context budget;
 *  - only instructions whose glob matches a file the review reads are sent.
 */
import { globToRegExp } from '@/ee/security/security-scan/reviewable-path'

/** Path instructions per repository. */
export const PATH_INSTRUCTIONS_MAX_ENTRIES = 20
/** Characters in one entry's glob. */
export const PATH_INSTRUCTION_PATH_MAX_CHARS = 200
/** Characters in one entry's instructions. */
export const PATH_INSTRUCTION_MAX_CHARS = 1_000
/** Characters of instructions one review prompt carries (≈ 1k tokens). */
export const REVIEW_PATH_INSTRUCTIONS_MAX_CHARS = 4_000
/** Characters in the tone instruction. */
export const TONE_INSTRUCTIONS_MAX_CHARS = 250

export interface PathInstruction {
  /** A glob over repository paths (same syntax as the path filters). */
  path: string
  instructions: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Whitespace (line breaks included) collapsed to single spaces. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * PURE — a stored / submitted list as clean entries: trimmed, blanks and
 * malformed entries dropped, bounded, the first entry for a glob kept.
 */
export function normalizePathInstructions(raw: unknown): PathInstruction[] {
  if (!Array.isArray(raw)) return []
  const out: PathInstruction[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!isRecord(item)) continue
    const path = typeof item.path === 'string' ? item.path.trim() : ''
    const instructions =
      typeof item.instructions === 'string' ? item.instructions.trim() : ''
    if (!path || !instructions || /[\r\n]/.test(path)) continue
    if (path.length > PATH_INSTRUCTION_PATH_MAX_CHARS) continue
    if (seen.has(path)) continue
    seen.add(path)
    out.push({
      path,
      instructions: instructions.slice(0, PATH_INSTRUCTION_MAX_CHARS),
    })
    if (out.length >= PATH_INSTRUCTIONS_MAX_ENTRIES) break
  }
  return out
}

/** PURE — a tone value as stored: one line, bounded; blank = null. */
export function normalizeToneInstructions(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = oneLine(raw).slice(0, TONE_INSTRUCTIONS_MAX_CHARS)
  return t.length > 0 ? t : null
}

/** PURE — the entries whose glob matches at least one reviewed file. */
export function matchingPathInstructions(
  list: readonly PathInstruction[],
  reviewedPaths: readonly string[]
): PathInstruction[] {
  return list.filter(entry => {
    let re: RegExp
    try {
      re = globToRegExp(entry.path)
    } catch {
      return false
    }
    return reviewedPaths.some(p => re.test(p))
  })
}

/**
 * PURE — the prompt block: one line per matching entry, `- [glob] text`,
 * each through `guard` (the caller passes `guardPromptLineText`), capped at
 * `REVIEW_PATH_INSTRUCTIONS_MAX_CHARS` on whole lines, in the listed order.
 * `''` when nothing matches.
 */
export function renderPathInstructions(
  list: readonly PathInstruction[],
  reviewedPaths: readonly string[],
  guard: (line: string) => string
): string {
  const lines: string[] = []
  let used = 0
  for (const entry of matchingPathInstructions(list, reviewedPaths)) {
    const text = oneLine(entry.instructions)
    if (!text) continue
    // The glob is workspace-authored too: guarded like the text.
    const line = `- [${guard(oneLine(entry.path))}] ${guard(text)}`
    if (used + line.length + 1 > REVIEW_PATH_INSTRUCTIONS_MAX_CHARS) break
    lines.push(line)
    used += line.length + 1
  }
  return lines.join('\n')
}

/** PURE — the tone line for the prompt (guarded, bounded); `''` = none. */
export function renderToneInstructions(
  tone: string | null | undefined,
  guard: (line: string) => string
): string {
  const t = normalizeToneInstructions(tone)
  return t ? guard(t) : ''
}
